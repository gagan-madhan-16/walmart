import { PrismaClient } from "../../generated";
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

const prisma = new PrismaClient();

interface CSVRow {
  'Uniq Id'?: string;
  'Crawl Timestamp'?: string;
  'Product Url'?: string;
  'Product Name'?: string;
  'Description'?: string;
  'List Price'?: string;
  'Sale Price'?: string;
  'Brand'?: string;
  'Item Number'?: string;
  'Gtin'?: string;
  'Package Size'?: string;
  'Category'?: string;
  'Postal Code'?: string;
  'Available'?: string;
  [key: string]: any; // Allow any additional fields
}

async function importCSVData() {
  console.log('🚀 Starting CSV import...');
  
  const csvPath = path.join(__dirname, 'data.csv');
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at: ${csvPath}`);
  }

  const records: CSVRow[] = [];
  
  // Read and parse CSV file
  return new Promise<void>((resolve, reject) => {
    let lineNumber = 0;
    let malformedRows = 0;
    
    fs.createReadStream(csvPath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_quotes: true, // Allow quotes in data
        relax_column_count: true, // Allow varying column counts
        skip_records_with_error: true, // Skip malformed records
      }))
      .on('data', (row: any) => {
        lineNumber++;
        
        // Validate that we have the minimum required fields
        if (row && typeof row === 'object' && row['Product Name']) {
          records.push(row as CSVRow);
        } else {
          malformedRows++;
          if (malformedRows <= 10) { // Only log first 10 malformed rows to avoid spam
            console.log(`⚠️  Skipping malformed row ${lineNumber}: Missing required fields`);
          }
        }
      })
      .on('error', (error) => {
        console.error(`❌ Error reading CSV at line ${lineNumber}:`, error);
        // Don't reject immediately, continue processing
        malformedRows++;
      })
      .on('skip', (error) => {
        malformedRows++;
        if (malformedRows <= 10) {
          console.log(`⚠️  Skipped malformed row: ${error.message}`);
        }
      })
      .on('end', async () => {
        console.log(`📄 Parsed ${records.length} valid records from CSV`);
        console.log(`⚠️  Skipped ${malformedRows} malformed/invalid rows`);
        
        try {
          let successCount = 0;
          let errorCount = 0;
          
          for (let i = 0; i < records.length; i++) {
            const row = records[i];
            
            try {
              // Clean and validate data - only using 4 specified fields
              const productName = row['Product Name']?.trim();
              const salePriceStr = row['Sale Price']?.toString().trim();
              const salePrice = salePriceStr ? parseFloat(salePriceStr) || 0 : 0;
              const isAvailable = row['Available']?.toString().toUpperCase() === 'TRUE';
              const productUrl = row['Product Url']?.trim() || '';
              
              // Skip if no product name
              if (!productName) {
                console.log(`⚠️  Skipping row ${i + 1}: No product name`);
                continue;
              }
              
              // Additional validation for product name length (Prisma might have limits)
              if (productName.length > 500) {
                console.log(`⚠️  Skipping row ${i + 1}: Product name too long`);
                continue;
              }
              
              // Check if product already exists (by name to avoid duplicates)
              const existingProduct = await prisma.product.findFirst({
                where: { name: productName }
              });
              
              if (existingProduct) {
                console.log(`⚠️  Product already exists: ${productName}`);
                continue;
              }
              
              // Create product with only the 4 required fields
              const product = await prisma.product.create({
                data: {
                  name: productName,
                  price: salePrice,
                  isAvailable: isAvailable,
                  productUrl: productUrl
                }
              });
              
              successCount++;
              
              if (successCount % 100 === 0) {
                console.log(`✅ Imported ${successCount} products...`);
              }
              
            } catch (error) {
              errorCount++;
              console.error(`❌ Error importing row ${i + 1} (${row['Product Name'] || 'Unknown Product'}):`, error);
              
              // Continue with next record instead of stopping
              if (errorCount > 50) { // Increased error threshold for better resilience
                console.error('❌ Too many errors, stopping import');
                break;
              }
            }
          }
          
          console.log(`🎉 Import completed!`);
          console.log(`✅ Successfully imported: ${successCount} products`);
          console.log(`❌ Errors: ${errorCount}`);
          console.log(`⚠️  Malformed rows skipped: ${malformedRows}`);
          
          resolve();
          
        } catch (error) {
          console.error('❌ Error during import:', error);
          reject(error);
        }
      });
  });
}

async function main() {
  try {
    console.log('🗄️  Connecting to database...');
    
    // Clear existing data (optional - comment out if you want to keep existing data)
    console.log('🧹 Clearing existing products...');
    await prisma.product.deleteMany();
    
    // Import CSV data
    await importCSVData();
    
    console.log('✅ Database population completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
