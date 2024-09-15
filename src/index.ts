import express from 'express';
import { ChatOpenAI } from "@langchain/openai";
import { ConversationChain } from "langchain/chains";
import { BufferMemory } from "langchain/memory";
import { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } from '@langchain/core/prompts';
import { createClient } from 'redis';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// const redisClient = createClient({
//   url: process.env.REDIS_URL || "rediss://chatbot-redis-przdzy.serverless.use1.cache.amazonaws.com:6379",
//   socket: {
//     tls: true,
//     rejectUnauthorized: false // Only use this for testing, not in production
//   }
// });

const redisClient = createClient({
  socket: {
    host: 'localhost',
    port: 6379,
  }
});

redisClient.on('error', (err:any) => console.log('Redis Client Error', err));

export async function connectToRedis() {
  await redisClient.connect();
}

export async function getChatHistory(sessionId: string): Promise<{ role: string; content: string }[]> {
  const key = sessionId;
  const history = await redisClient.lRange(key, 0, -1);
  return history.map((item: string) => JSON.parse(item));
}

export async function addToChatHistory(sessionId: string, role: string, content: string): Promise<void> {
  const key = sessionId;
  await redisClient.rPush(key, JSON.stringify({ role, content }));
  await redisClient.lTrim(key, -5, -1);
}

export async function clearConversationHistory(sessionId: string): Promise<void> {
  const key = sessionId;
  await redisClient.del(key);
}

const model = new ChatOpenAI({
  modelName: "gpt-4",
  maxTokens: 300,
  streaming: true,
});

export async function getOpenAIResponse(input: string, sessionId: string): Promise<string> {
  try {
    const systemPrompt = `You are a professional medical assistant / bot created by Dr. Mrinmoy Das. You are not linked with OpenAI or any other organization, not ChatGPT or GPT-3 or GPT-4. You are a special AI bot only created by Mrinmoy, specialized in analyzing medical complaints, history, reports, and providing concise analysis to doctors. Ask any question you require to analyze better. After you get at least age, sex, medical reports, and complaints, then only reply in short, crisp analysis. Before that, ask follow-up questions and always reply in professional medical terms and language. Don't add your view or any other instruction or advice for using your data. I support audio and images for better understanding. You can upload any image of reports or medical images.`;

    const chatHistory = await getChatHistory(`chatbot_${sessionId}`);
    await addToChatHistory(`chatbot_${sessionId}`, 'human', input);

    const promptTemplate = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(systemPrompt),
      ...chatHistory.map(msg => 
        msg.role === 'human' 
          ? HumanMessagePromptTemplate.fromTemplate(msg.content)
          : SystemMessagePromptTemplate.fromTemplate(msg.content)
      ),
      HumanMessagePromptTemplate.fromTemplate("{input}")
    ]);

    const memory = new BufferMemory({ returnMessages: true, memoryKey: "history" });

    const chain = new ConversationChain({
      memory,
      prompt: promptTemplate,
      llm: model as any,
    });

    const response = await chain.call({ input });
    console.log("response", response.response);
    
    await addToChatHistory(`chatbot_${sessionId}`, 'ai', response.response);
    return response.response;
  } catch (error) {
    console.error("Error calling OpenAI API:", (error as Error).message || error);
    throw new Error("Unable to retrieve response from OpenAI API.");
  }
}

// Single API endpoint for chat
app.post('/chat', async (req, res) => {
  const { sessionId, input } = req.body;
  
  if (!sessionId || !input) {
    return res.status(400).json({ error: 'SessionId and input are required' });
  }

  try {
    const response = await getOpenAIResponse(input, sessionId);
    res.json({ response });
  } catch (error) {
    res.status(500).json({ error: 'An error occurred while processing the chat request' });
  }
});

// Start the server
async function startServer() {
  try {
    await connectToRedis();
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start the server:", error);
  }
}

startServer();