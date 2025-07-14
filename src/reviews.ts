import express from 'express';
import axios from 'axios';
import { JSDOM } from 'jsdom';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from 'redis';

const app = express();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_KEY_HERE';

const redis = createClient({
    username: 'default',
    password: 'eQvXvSHHASayp4owrToBlOLaeDcLKT3d',
    socket: {
        host: 'redis-10791.crce182.ap-south-1-1.ec2.redns.redis-cloud.com',
        port: 10791
    }
});

app.use(cors());

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Proxy headers
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept-Language': 'en-US,en;q=0.9',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Amazon review scraper
const scrapeAmazonReviews = async (product: string) => {
  try {
    const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(product)}`;
    const searchPage = await axios.get(searchUrl, { headers });
    const dom = new JSDOM(searchPage.data);
    const doc = dom.window.document;
    const productLink = doc.querySelector('a.a-link-normal.s-no-outline')?.getAttribute('href');
    if (!productLink) return [];

    await sleep(2000);
    const productUrl = `https://www.amazon.in${productLink}`;
    const productPage = await axios.get(productUrl, { headers });
    const productDOM = new JSDOM(productPage.data);
    const reviewElements = productDOM.window.document.querySelectorAll('div[data-hook="review"]');

    const reviews = Array.from(reviewElements).map((el: Element) => {
      const rating = el.querySelector('[data-hook="review-star-rating"] span')?.textContent;
      const title = el.querySelector('[data-hook="review-title"] span')?.textContent;
      const review = el.querySelector('[data-hook="review-body"] span')?.textContent;
      const author = el.querySelector('.a-profile-name')?.textContent;
      const date = el.querySelector('[data-hook="review-date"]')?.textContent;

      return { source: 'Amazon', rating, title, review, author, date };
    });

    return reviews.slice(0, 5);
  } catch (error) {
    console.error('Amazon error:', error);
    return [];
  }
};

// Flipkart scraper
const scrapeFlipkartReviews = async (product: string) => {
  try {
    const searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(product)}`;
    const searchPage = await axios.get(searchUrl, { headers });
    const dom = new JSDOM(searchPage.data);
    const doc = dom.window.document;
    const productLink = doc.querySelector('a._1fQZEK, a.IRpwTa')?.getAttribute('href');
    if (!productLink) return [];

    await sleep(2000);
    const productUrl = `https://www.flipkart.com${productLink}`;
    const productPage = await axios.get(productUrl, { headers });
    const productDOM = new JSDOM(productPage.data);
    const reviewElements = productDOM.window.document.querySelectorAll('div._27M-vq');

    const reviews = Array.from(reviewElements).map((el: Element) => {
      const rating = el.querySelector('._3LWZlK')?.textContent;
      const title = el.querySelector('p._2-N8zT')?.textContent;
      const review = el.querySelector('div.t-ZTKy div')?.textContent;
      const author = el.querySelector('p._2sc7ZR._2V5EHH')?.textContent;
      const date = el.querySelector('p._2sc7ZR')?.textContent;

      return { source: 'Flipkart', rating, title, review, author, date };
    });

    return reviews.slice(0, 5);
  } catch (error) {
    console.error('Flipkart error:', error);
    return [];
  }
};

// Google search scraper for official product sites
const scrapeGoogleResults = async (product: string) => {
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(product + ' reviews site:' + product.split(' ')[0] + '.com')}`;
    const searchPage = await axios.get(searchUrl, { headers });
    const dom = new JSDOM(searchPage.data);
    const links = dom.window.document.querySelectorAll('a');

    const results: string[] = [];
    links.forEach((link: Element) => {
      const href = (link as HTMLAnchorElement).href;
      if (href && href.includes('http') && !href.includes('google.com')) {
        results.push(href);
      }
    });

    return results.slice(0, 3); // Top 3 links
  } catch (error) {
    console.error('Google search error:', error);
    return [];
  }
};

// NLP summarizer using Gemini
const summarizeReviews = async (reviews: string[]) => {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_KEY_HERE') {
    return 'Gemini API key not set';
  }

  try {
    // Get the generative model
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

    const prompt = `
    You are a product review analyst. Summarize the overall sentiment and common pros/cons from the following product reviews.
    
    Please provide:
    1. Overall sentiment (positive/negative/mixed)
    2. Common pros mentioned
    3. Common cons mentioned
    4. Overall recommendation
    
    Reviews:
    ${reviews.join('\n\n')}
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();

  } catch (err) {
    console.error('Gemini summarization error:', err);
    return 'Summarization failed';
  }
};

app.get('/search', async (req, res) => {
  const {product} = req.body;

  if (!product) return res.status(400).json({ error: 'Missing product parameter' });

  const cacheKey = `reviews:${product.toLowerCase()}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return res.json(JSON.parse(cached));
  }

  const [amazonReviews, flipkartReviews, officialLinks] = await Promise.all([
    scrapeAmazonReviews(product),
    scrapeFlipkartReviews(product),
    scrapeGoogleResults(product),
  ]);

  const allReviews = [...amazonReviews, ...flipkartReviews];
  const reviewTexts = allReviews.map((r) => `${r.title}: ${r.review}`);
  const summary = await summarizeReviews(reviewTexts);

  const response = { product, summary, reviews: allReviews, officialLinks };
  await redis.set(cacheKey, JSON.stringify(response), { EX: 3600 }); // Cache for 1 hour

  return res.json(response);
});

export default app