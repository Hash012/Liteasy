import { useRef } from "react";
import type { ModelTransport } from "../features/models/modelHttpClient";
import { getDefaultModelForProvider } from "../features/models/modelPolicy";
import { createModelGatewayFromSettings } from "../features/models/modelRuntime";
import type { createSettingsStore } from "../features/settings/settings.store";
import type { Paper } from "../features/workspace/workspace.types";
import {
  createPaperTranslationRepository,
  type PaperTranslationRepository
} from "../features/import/paperTranslationRepository";
import {
  createPaperTranslationController,
  type TranslationRequestOptions,
  type TranslationSessionCache
} from "./paperTranslationController";

type SettingsStore = Pick<ReturnType<typeof createSettingsStore>, "getState">;

type UsePaperTranslationControllerInput = {
  modelTransport?: ModelTransport;
  translationRepository?: PaperTranslationRepository;
  settingsStore: SettingsStore;
};

type TranslationPaper = Pick<Paper, "id" | "title">;

export function usePaperTranslationController({
  modelTransport,
  translationRepository,
  settingsStore
}: UsePaperTranslationControllerInput) {
  const cacheRef = useRef<TranslationSessionCache | null>(null);
  const repositoryRef = useRef<PaperTranslationRepository | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = new Map<string, string>();
  }
  if (!repositoryRef.current) {
    repositoryRef.current = translationRepository ?? createPaperTranslationRepository();
  }

  async function loadPaperResourceTranslations(paper: TranslationPaper, markedSource: string) {
    return repositoryRef.current!.list({ markedSource, paperId: paper.id });
  }

  async function translatePaperResource(
    paper: TranslationPaper,
    sourceLanguage: string,
    targetLanguage: string,
    markedSource: string,
    options: TranslationRequestOptions
  ) {
    const settings = settingsStore.getState();
    const provider = settings["models.default_provider"];
    const model = getDefaultModelForProvider(provider);
    const gateway = createModelGatewayFromSettings(settings, { cloudTransport: modelTransport });
    const controller = createPaperTranslationController({
      cache: cacheRef.current!,
      cacheNamespace: `${provider}:${model}`,
      endpoint: settings["models.cloud_proxy_endpoint"],
      generate: async ({ prompt, signal }) => {
        const result = await gateway.generateAnswer({
          model,
          prompt,
          provider,
          requireLive: true,
          signal
        });
        return result.answer;
      },
      paperTitle: paper.title
    });
    const translation = await controller.translate(sourceLanguage, targetLanguage, markedSource, options);
    await repositoryRef.current!.save({
      content: translation,
      markedSource,
      paperId: paper.id,
      sourceLanguage,
      targetLanguage
    });
    return translation;
  }

  return {
    actions: {
      loadPaperResourceTranslations,
      translatePaperResource
    }
  };
}
