import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./db";
import { AisleFace } from "../generated";

// Interface for product structure
interface Product {
  name: string;
  id: string;
}

// Interface for Gemini response
interface GeminiResponse {
  products: Product[];
}

interface ProductAdress {
  floor: number,
  latitude: string,
  longitude: string
  aisle_face: AisleFace,
  shelf: number,
  start_position: number,
  end_position: number,
}


const router = express.Router();

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Function to clean JSON response from markdown formatting
function cleanJsonResponse(response: string): string {
  // Remove markdown code blocks
  let cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  
  // Remove any leading/trailing whitespace
  cleaned = cleaned.trim();
  
  // If the response starts with explanatory text, try to extract just the JSON
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  
  return cleaned;
}

// Retry function to ensure correct JSON format
async function retryForCorrectFormat(model: any, originalText: string, incorrectResponse: string, maxRetries = 3): Promise<GeminiResponse> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Retry attempt ${attempt} for correct JSON format`);
      
      const retryResponse = await model.generateContent({
        contents: [{
          role: "user",
          parts: [
            { text: `Original user request: "${originalText}"` },
            { text: `You previously responded with: "${incorrectResponse}"` },
            { text: `This response was not in valid JSON format. Please correct it and respond with ONLY this exact JSON structure:` },
            { text: JSON.stringify({ 
                products:[{
                    name: "exact name from available items",
                    id: "exact id from available items",
                    price: "exactly as given as an input",
                    productUrl: "exactly as given as an input"
                }]
            }) },
            { text: `IMPORTANT: Only use products that actually exist in the database. Do NOT create new product names or leave IDs empty.` },
            { text: `Make sure to return ONLY valid JSON, no additional text or explanation.` }
          ]
        }]
      });

      const correctedResponse = retryResponse.response.text();
      
      // Clean the response before parsing
      const cleanedResponse = cleanJsonResponse(correctedResponse);
      console.log("Cleaned response:", cleanedResponse);
      
      // Try to parse the corrected response
      const parsedResult: GeminiResponse = JSON.parse(cleanedResponse);
      
      // Validate the structure and content
      if (parsedResult && 
          typeof parsedResult === 'object' &&
          Array.isArray(parsedResult.products) &&
          parsedResult.products.every(product => 
            typeof product.name === 'string' && 
            typeof product.id === 'string' &&
            product.name.trim() !== '' &&
            product.id.trim() !== ''
          )) {
        
        console.log(`Successfully got correct format on retry attempt ${attempt}`);
        return parsedResult;
      } else {
        throw new Error("Response structure is incorrect or contains empty fields");
      }
    } catch (error) {
      console.log(`Retry attempt ${attempt} failed:`, error);
      
      if (attempt === maxRetries) {
        // If all retries failed, return default structure
        console.log("All retry attempts failed, returning default structure");
        return {
          products: [],
          incorrectResponse: incorrectResponse,
          error: "Failed to get correct format after retries",
          raw_response: incorrectResponse
        } as any;
      }
      
      // Update incorrectResponse for next retry
      if (error instanceof Error) {
        incorrectResponse = `Previous attempt failed with error: ${error.message}`;
      }
    }
  }
  
  // Fallback (though this should never be reached)
  return { products: [] };
}

// POST route to classify user intent and return categorized items
router.post("/list", async (req, res) => {
  try {
    const { text } = req.body;

    // Validate input
    if (!text || typeof text !== "string") {
      return res.status(400).json({
        error: "Text input is required and must be a string"
      });
    }

    // Check if API key is configured
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Gemini API key is not configured. Please set GEMINI_API_KEY in your environment variables."
      });
    }

    // Get the generative model
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    // Available items for classification
    const products = await db.product.findMany({
      select: {
        id: true,
        name: true,
        price: true,
        productUrl: true
      },
      where: { isAvailable: true }
    });

    const response = await model.generateContent({
      contents: [{
        role: "user",
        parts: [
          { text: `User said: "${text}"` },
          { text: `Available items with their IDs: ${JSON.stringify(products)}` },
          { text: `IMPORTANT: You must ONLY select products from the available items list above. Match the user's intent to existing products and return their exact names and IDs.` },
          { text: `If the user wants "chocolate cake", look for similar items like "cake", "chocolate", "dessert" etc. in the food_and_fmcg category.` },
          { text: `If the user wants "graphics card", look for "GPU", "graphics card" etc. in the electronics_and_electrical_equipment category.` },
          { text: `Strictly return this JSON format with ONLY products that exist in the available items:` },
          { text: JSON.stringify({
            products:[{
                name: "exact name from available items",
                id: "exact id from available items",
                price: "exactly as given as an input",
                productUrl: "exactly as given as an input"
            }]
          }) },
          { text: `Do NOT create new product names. Only use products that exist in the available items list.` }
        ]
      }]
    });

    const geminiResponse = response.response.text();
    console.log("Raw Gemini response:", geminiResponse);
    
    let result: GeminiResponse;
    try {
      // Clean the response before parsing
      const cleanedResponse = cleanJsonResponse(geminiResponse);
      console.log("Cleaned response:", cleanedResponse);
      
      result = JSON.parse(cleanedResponse);
      
      // Validate the structure and content
      if (!result || 
          typeof result !== 'object' ||
          !Array.isArray(result.products) ||
          !result.products.every(product => 
            typeof product.name === 'string' && 
            typeof product.id === 'string' &&
            product.name.trim() !== '' &&
            product.id.trim() !== ''
          )) {
        
        console.log("Response structure is incorrect or contains empty fields, retrying...");
        result = await retryForCorrectFormat(model, text, geminiResponse);
      }
    } catch (parseError) {
      console.log("JSON parsing failed, retrying for correct format...");
      result = await retryForCorrectFormat(model, text, geminiResponse);
    }

    // Final validation: Check if returned products actually exist in database
    const validProducts = [];
    for (const product of result.products) {
      const dbProduct = await db.product.findFirst({
        where: {
          id: product.id,
          name: product.name,
          isAvailable: true
        },
        select: {
          id: true,
          name: true
        }
      });
      
      if (dbProduct) {
        validProducts.push(dbProduct);
      } else {
        console.log(`Product not found in database:`, product);
      }
    }

    // Get addresses only for valid products
    const ProductAddresses: ProductAdress[] = [];
    for(let i = 0; i < validProducts.length; i++){
        const address = await db.productAdress.findFirst({
            select:{
                floor: true, 
                latitude: true,
                longitude: true,
                aisle_face: true,
                shelf: true,
                start_position: true,
                end_position: true
            },
            where:{
                productId: validProducts[i].id
            }
        });
        
        if (address) {
            ProductAddresses.push(address);
        }
    }

    res.status(200).json({
        products: validProducts,
        ProductAddresses: ProductAddresses,
        totalFoundProducts: validProducts.length,
        totalRequestedProducts: result.products.length
    });

  } catch (error) {
    console.error("Error in Gemini route:", error);
    res.status(500).json({
      error: "Failed to get response from Gemini AI",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

export default router;
