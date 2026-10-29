import type { AssistantCreativeMemory } from "@/lib/assistant-memory";
import type { ImageProviderProtocol } from "@/lib/image-model-capabilities";

export type AssistantRequestSnapshot = {
  identityToken: number;
  body: {
    model: string;
    assistantProviderId: string;
    assistantGroup?: string;
    reasoningEffort?: string;
    creativeMemory?: AssistantCreativeMemory[];
    allowWikipedia: boolean;
    conversationId: string;
    imageModel: string;
    modelProtocol: ImageProviderProtocol;
    operation: string;
    currentPrompt: string;
    currentNegativePrompt: string;
    images: string[];
  };
};
