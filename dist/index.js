"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectToRedis = connectToRedis;
exports.getChatHistory = getChatHistory;
exports.addToChatHistory = addToChatHistory;
exports.clearConversationHistory = clearConversationHistory;
exports.getOpenAIResponse = getOpenAIResponse;
const express_1 = __importDefault(require("express"));
const openai_1 = require("@langchain/openai");
const chains_1 = require("langchain/chains");
const memory_1 = require("langchain/memory");
const prompts_1 = require("@langchain/core/prompts");
const redis_1 = require("redis");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
app.use(express_1.default.json());
const redisClient = (0, redis_1.createClient)({
    socket: {
        host: 'localhost',
        port: 6379,
    }
});
redisClient.on('error', (err) => console.log('Redis Client Error', err));
function connectToRedis() {
    return __awaiter(this, void 0, void 0, function* () {
        yield redisClient.connect();
    });
}
function getChatHistory(sessionId) {
    return __awaiter(this, void 0, void 0, function* () {
        const key = sessionId;
        const history = yield redisClient.lRange(key, 0, -1);
        return history.map((item) => JSON.parse(item));
    });
}
function addToChatHistory(sessionId, role, content) {
    return __awaiter(this, void 0, void 0, function* () {
        const key = sessionId;
        yield redisClient.rPush(key, JSON.stringify({ role, content }));
        yield redisClient.lTrim(key, -5, -1);
    });
}
function clearConversationHistory(sessionId) {
    return __awaiter(this, void 0, void 0, function* () {
        const key = sessionId;
        yield redisClient.del(key);
    });
}
const model = new openai_1.ChatOpenAI({
    modelName: "gpt-4",
    maxTokens: 300,
    streaming: true,
});
function getOpenAIResponse(input, sessionId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const systemPrompt = `You are a professional medical assistant / bot created by Dr. Mrinmoy Das. You are not linked with OpenAI or any other organization, not ChatGPT or GPT-3 or GPT-4. You are a special AI bot only created by Mrinmoy, specialized in analyzing medical complaints, history, reports, and providing concise analysis to doctors. Ask any question you require to analyze better. After you get at least age, sex, medical reports, and complaints, then only reply in short, crisp analysis. Before that, ask follow-up questions and always reply in professional medical terms and language. Don't add your view or any other instruction or advice for using your data. I support audio and images for better understanding. You can upload any image of reports or medical images.`;
            const chatHistory = yield getChatHistory(`chatbot_${sessionId}`);
            yield addToChatHistory(`chatbot_${sessionId}`, 'human', input);
            const promptTemplate = prompts_1.ChatPromptTemplate.fromMessages([
                prompts_1.SystemMessagePromptTemplate.fromTemplate(systemPrompt),
                ...chatHistory.map(msg => msg.role === 'human'
                    ? prompts_1.HumanMessagePromptTemplate.fromTemplate(msg.content)
                    : prompts_1.SystemMessagePromptTemplate.fromTemplate(msg.content)),
                prompts_1.HumanMessagePromptTemplate.fromTemplate("{input}")
            ]);
            const memory = new memory_1.BufferMemory({ returnMessages: true, memoryKey: "history" });
            const chain = new chains_1.ConversationChain({
                memory,
                prompt: promptTemplate,
                llm: model,
            });
            const response = yield chain.call({ input });
            console.log("response", response.response);
            yield addToChatHistory(`chatbot_${sessionId}`, 'ai', response.response);
            return response.response;
        }
        catch (error) {
            console.error("Error calling OpenAI API:", error.message || error);
            throw new Error("Unable to retrieve response from OpenAI API.");
        }
    });
}
app.post('/chat', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sessionId, input } = req.body;
    if (!sessionId || !input) {
        return res.status(400).json({ error: 'SessionId and input are required' });
    }
    try {
        const response = yield getOpenAIResponse(input, sessionId);
        res.json({ response });
    }
    catch (error) {
        res.status(500).json({ error: 'An error occurred while processing the chat request' });
    }
}));
function startServer() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield connectToRedis();
            app.listen(port, () => {
                console.log(`Server is running on port ${port}`);
            });
        }
        catch (error) {
            console.error("Failed to start the server:", error);
        }
    });
}
startServer();
