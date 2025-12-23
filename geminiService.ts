
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function analyzeImageSemantics(base64Image: string) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { data: base64Image.split(',')[1], mimeType: 'image/jpeg' } },
          { text: "Generate 5 precise semantic tags for this image. Output only the tags separated by commas." }
        ]
      }
    });

    const text = response.text || "";
    return text.split(',').map(t => t.trim().toLowerCase());
  } catch (error) {
    console.error("Gemini analysis failed:", error);
    return [];
  }
}

export async function searchByDescription(description: string, imageContext: string[]) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Given the user search query: "${description}", and a set of image keywords: [${imageContext.join(', ')}], return a list of keywords that most closely match the intent. Return ONLY the relevant keywords as a JSON array.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });
    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("Semantic search failed:", error);
    return [];
  }
}
