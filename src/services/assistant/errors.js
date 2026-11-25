/** Typed error thrown by Stage-2 providers; the service catches it and falls back to rules. */
export class AssistantProviderError extends Error {
  constructor(message, provider) {
    super(message);
    this.name = 'AssistantProviderError';
    this.provider = provider;
  }
}
