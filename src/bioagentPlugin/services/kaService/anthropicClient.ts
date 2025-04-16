import "dotenv/config";
import { Anthropic } from "@anthropic-ai/sdk";
import { logger } from "@elizaos/core";

const apiKey: string | undefined = process.env.ANTHROPIC_API_KEY;

export function getClient(): Anthropic {
    logger.info(`Initializing Anthropic client with API key: ${apiKey ? "API key is set" : "API key is not set"}`);
    return new Anthropic({ apiKey });
}

export async function generateResponse(
    client: Anthropic,
    prompt: string,
    model: string = "claude-3-5-sonnet-20241022",
    maxTokens: number = 1500
): Promise<string> {
    logger.info(`Generating response with model: ${model}, max tokens: ${maxTokens}`);
    logger.info(`Prompt length: ${prompt.length} characters`);
    
    try {
        const response = await client.messages.create({
            model: model,
            max_tokens: maxTokens,
            messages: [{ role: "user", content: prompt }],
        });

        logger.info(`Response received from Claude. Content length: ${response.content ? response.content.length : 0}`);

        if (
            response.content &&
            response.content.length > 0 &&
            response.content[0].type === "text"
        ) {
            const responseText = response.content[0].text;
            logger.info(`Response text length: ${responseText.length} characters`);
            return responseText;
        } else {
            logger.error("No text content in Claude response", response);
            throw new Error("No response received from Claude.");
        }
    } catch (error) {
        logger.error("Error generating response from Claude:", error);
        throw error;
    }
}
