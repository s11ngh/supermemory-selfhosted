import OpenAI from "openai";

let client: OpenAI;

const EMBEDDING_MODEL = "qwen/qwen3-embedding-8b";
const EMBEDDING_DIMENSIONS = 1536;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.NOVITA_API_KEY,
      baseURL: "https://api.novita.ai/openai",
    });
  }
  return client;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const truncated = text.slice(0, 8000);

  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncated,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data[0].embedding;
}

export async function generateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  const truncated = texts.map((t) => t.slice(0, 8000));

  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: truncated,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data.map((d) => d.embedding);
}
