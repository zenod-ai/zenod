// Shared CLI/default-to-adapter contract; production configuration is untouched.
export const classifyModelOption = {type:'string',default:'minimax/minimax-m3'};
export const organizerReasoningOption = {type:'string'};
export function evaluationModels(args) {
  const classifyModel=args['classify-model'] ?? classifyModelOption.default;
  const askModel=args['ask-model'] ?? 'x-ai/grok-4.3';
  if (![classifyModel,askModel].every(value=>typeof value==='string'&&value.trim()===value&&value.length>0)) throw new Error('Nonempty exact model identifiers required');
  const organizerReasoningEffort=args['organizer-reasoning-effort'];
  if (organizerReasoningEffort!==undefined&&!['none','low'].includes(organizerReasoningEffort)) throw new Error('Organizer reasoning effort must be none, low or omitted');
  const providerValue=args['organizer-provider-order'];
  const organizerProviderOrder=providerValue?.split(',');
  if(organizerProviderOrder && (organizerProviderOrder.length>3 || new Set(organizerProviderOrder).size!==organizerProviderOrder.length || organizerProviderOrder.some(slug=>!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)))) throw new Error('Organizer provider order requires 1–3 unique comma-separated base provider slugs');
  return {classifyModel,askModel,...(organizerProviderOrder?{organizerProviderOrder}:{}),...(organizerReasoningEffort?{organizerReasoningEffort}:{})};
}
