const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => { res.setHeader("ngrok-skip-browser-warning", "1"); next(); });
app.use(express.static(path.join(__dirname, "public")));

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN; // shpat_ admin token
const SHOPIFY_STOREFRONT = process.env.SHOPIFY_STOREFRONT;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const OPENAI_KEY = process.env.OPENAI_KEY;

// ── GET /api/products ── fetch products via Storefront API ───────────────────
app.get("/api/products", async (req, res) => {
  try {
    const query = `{
      products(first: 250) {
        edges {
          node {
            id title productType tags
            variants(first: 1) { edges { node { price { amount } } } }
            images(first: 5) { edges { node { url altText } } }
          }
        }
      }
    }`;
    const r = await fetch(`https://${SHOPIFY_STORE}/api/2024-01/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT,
      },
      body: JSON.stringify({ query }),
    });
    const data = await r.json();
    if (data.errors) return res.status(400).json({ error: data.errors[0].message });
    const products = (data.data?.products?.edges || []).map(({ node }) => ({
      id: node.id,
      title: node.title,
      product_type: node.productType,
      tags: node.tags || [],
      price: node.variants.edges[0]?.node.price.amount || "0",
      images: node.images.edges.map(e => e.node.url),
    }));
    res.json({ products });
  } catch (e) {
    console.error("[generate-image] ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/analyze ── Claude analyzes product style ───────────────────────
app.post("/api/analyze", async (req, res) => {
  const { product, catStyle, anthropicKey } = req.body;
  const ANTHRO = anthropicKey || ANTHROPIC_KEY;
  if (!ANTHRO) return res.status(400).json({ error: "No Anthropic API key" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHRO,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        system: "Product photography and social media expert for jewelry. Return ONLY valid JSON.",
        messages: [{
          role: "user",
          content: `Product: "${product.title}" (${product.product_type}, ${product.price}€). PD Paola style: ${JSON.stringify(catStyle)}. Return JSON: {"style_changes":{"background":"","lighting":"","color_grading":"","composition":""},"shopify_alt_text":"Spanish SEO 125 chars","instagram_caption":"Spanish with hashtags","pinterest_description":"Spanish 150-300 chars","tiktok_hook":"Spanish punchy hook","etsy_title":"Spanish SEO title","summary":"1 sentence","dalle_prompt":"English DALL-E 3 prompt, detailed, max 200 chars"}`
        }]
      })
    });
    const data = await r.json();
    const text = data.content?.[0]?.text || "{}";
    const result = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/generate-image ── GPT-4o edits product photo in PD Paola style ──
app.post("/api/generate-image", async (req, res) => {
  const { imageUrl, category, title, shotType } = req.body;
  try {
    const FormData = require("form-data");

    // Shot type prompts per category
    const shots = {
      earrings: {
        model1:   "IMPORTANT: Keep the EXACT earrings from the reference image, do not change the jewelry. Elegant female model wearing ONLY these earrings. Upper body portrait, face turned slightly. Pure white seamless background. Soft natural diffused light. Minimal makeup. PD Paola editorial style.",
        model2:   "IMPORTANT: Keep the EXACT earrings from the reference image, do not change the jewelry. Elegant female model wearing ONLY these earrings. Side profile close-up on ear. Pure white seamless background. Soft natural diffused light. PD Paola editorial style.",
        detail1:  "IMPORTANT: Keep the EXACT earrings from the reference image, do not change the jewelry. Extreme close-up macro shot of the earring on an ear. White cream background. Sharp focus on the earring detail. PD Paola editorial style.",
        detail2:  "IMPORTANT: Keep the EXACT earrings from the reference image, do not change the jewelry. Close-up of elegant female fingers holding the earring. White background. Studio lighting highlighting metal texture. PD Paola editorial style.",
        product1: "IMPORTANT: Keep the EXACT earring from the reference image. Single earring lying flat on a pure white surface. Top-down view. Soft even lighting. Minimalist product photography. PD Paola style.",
        product2: "IMPORTANT: Keep the EXACT earring from the reference image. Single earring standing or hanging on pure white seamless background. Side view. Soft studio lighting. Minimalist product photography. PD Paola style.",
      },
      necklaces: {
        model1:   "IMPORTANT: Keep the EXACT necklace from the reference image, do not change the jewelry. Elegant female model wearing ONLY this necklace. Décolleté and neck portrait. Pure white seamless background. Soft natural light. Minimal makeup. PD Paola editorial style.",
        model2:   "IMPORTANT: Keep the EXACT necklace from the reference image, do not change the jewelry. Elegant female model wearing ONLY this necklace. Close-up on neck and chest. Pure white seamless background. PD Paola editorial style.",
        detail1:  "IMPORTANT: Keep the EXACT necklace from the reference image, do not change the jewelry. Close-up macro of necklace on skin showing pendant detail. White background. PD Paola editorial style.",
        detail2:  "IMPORTANT: Keep the EXACT necklace from the reference image, do not change the jewelry. Elegant female fingers holding the necklace pendant. White background. Studio lighting. PD Paola editorial style.",
        product1: "IMPORTANT: Keep the EXACT necklace from the reference image. Necklace laid flat on pure white surface. Top-down view. Soft even lighting. Minimalist product photography. PD Paola style.",
        product2: "IMPORTANT: Keep the EXACT necklace from the reference image. Necklace hanging on pure white seamless background. Centered. Soft studio lighting. Minimalist product photography. PD Paola style.",
      },
      rings: {
        model1:   "IMPORTANT: Keep the EXACT ring from the reference image, do not change the jewelry. Elegant female hand wearing ONLY this ring. Hand posed naturally. Pure white seamless background. Bright even studio lighting. PD Paola editorial style.",
        model2:   "IMPORTANT: Keep the EXACT ring from the reference image, do not change the jewelry. Close-up macro of elegant female fingers with ONLY this ring. White background. Sharp lighting highlighting metal. PD Paola editorial style.",
        detail1:  "IMPORTANT: Keep the EXACT ring from the reference image, do not change the jewelry. Extreme macro close-up of the ring on fingertip. White background. Sharp focus on metal and texture detail. PD Paola style.",
        detail2:  "IMPORTANT: Keep the EXACT ring from the reference image, do not change the jewelry. Ring held between elegant fingertips. White background. Studio lighting. PD Paola editorial style.",
        product1: "IMPORTANT: Keep the EXACT ring from the reference image. Ring standing upright on pure white surface. Front view. Bright even lighting. Minimalist product photography. PD Paola style.",
        product2: "IMPORTANT: Keep the EXACT ring from the reference image. Ring lying flat on pure white surface. Top-down view. Soft studio lighting. Minimalist product photography. PD Paola style.",
      },
      bracelets: {
        model1:   "IMPORTANT: Keep the EXACT bracelet from the reference image, do not change the jewelry. Elegant female wrist wearing ONLY this bracelet. Wrist raised naturally. Pure white seamless background. Soft natural light. PD Paola editorial style.",
        model2:   "IMPORTANT: Keep the EXACT bracelet from the reference image, do not change the jewelry. Elegant female hand and wrist wearing ONLY this bracelet. Close-up. White background. PD Paola editorial style.",
        detail1:  "IMPORTANT: Keep the EXACT bracelet from the reference image, do not change the jewelry. Close-up macro of bracelet clasp and detail on wrist. White background. PD Paola editorial style.",
        detail2:  "IMPORTANT: Keep the EXACT bracelet from the reference image, do not change the jewelry. Elegant fingers holding the bracelet open. White background. Studio lighting. PD Paola editorial style.",
        product1: "IMPORTANT: Keep the EXACT bracelet from the reference image. Bracelet laid flat on pure white surface. Top-down view. Soft even lighting. Minimalist product photography. PD Paola style.",
        product2: "IMPORTANT: Keep the EXACT bracelet from the reference image. Bracelet standing or curved on pure white seamless background. Soft studio lighting. Minimalist product photography. PD Paola style.",
      },
    };

    const catShots = shots[category] || shots.necklaces;
    const shot = catShots[shotType] || catShots.model1;
    const prompt = `${shot} Product name: ${title}. Final result must look like a luxury PD Paola campaign photo: clean, minimal, elegant, professional.`;

    console.log("[generate-image] category:", category, "shotType:", shotType, "hasBase64:", !!imageBase64, "imageUrl:", imageUrl ? imageUrl.substring(0,80) : null);
    // Get image buffer
    let imgBuffer, ext;
    if (imageBase64) {
      const matches = imageBase64.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
      ext = matches ? matches[1] : "jpeg";
      imgBuffer = Buffer.from(matches ? matches[2] : imageBase64, "base64");
    } else {
      // Resolve relative proxy URLs to absolute localhost
      let fetchUrl = imageUrl;
      if (imageUrl && imageUrl.startsWith("/api/proxy-image")) {
        const params = new URLSearchParams(imageUrl.split("?")[1]);
        fetchUrl = params.get("url");
      }
      const imgRes = await fetch(fetchUrl);
      imgBuffer = await imgRes.buffer();
      const contentType = imgRes.headers.get("content-type") || "image/jpeg";
      ext = contentType.includes("png") ? "png" : "jpeg";
    }

    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt);
    form.append("n", "1");
    form.append("size", "1024x1024");
    form.append("image[]", imgBuffer, { filename: `product.${ext}`, contentType });

    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}`, ...form.getHeaders() },
      body: form,
    });
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    const b64 = data.data?.[0]?.b64_json;
    if (b64) return res.json({ url: `data:image/png;base64,${b64}` });
    res.json({ url: data.data?.[0]?.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/shopify/product/:id/image ── update Shopify product image ────────
app.put("/api/shopify/product/:id/image", async (req, res) => {
  if (!SHOPIFY_TOKEN) return res.status(400).json({ error: "No Admin token configured" });
  const { imageUrl, altText } = req.body;
  const productId = req.params.id.replace("gid://shopify/Product/", "");
  try {
    // Upload image to Shopify product
    const r = await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/products/${productId}/images.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_TOKEN,
      },
      body: JSON.stringify({ image: { src: imageUrl, alt: altText || "" } })
    });
    const data = await r.json();
    if (data.errors) return res.status(400).json({ error: JSON.stringify(data.errors) });
    res.json({ success: true, image: data.image });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/proxy-image?url=... ── proxy Shopify CDN images ─────────────────
app.get("/api/proxy-image", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("No URL");
  try {
    const r = await fetch(url);
    const buffer = await r.buffer();
    res.set("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✦ noholab server running on http://localhost:${PORT}`));
