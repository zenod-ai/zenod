// Shared CLI/default-to-adapter contract; production configuration is untouched.
export const classifyModelOption = {type:'string',default:'minimax/minimax-m3'};
export function evaluationModels(args) {
  const classifyModel=args['classify-model'] ?? classifyModelOption.default;
  const askModel=args['ask-model'] ?? 'x-ai/grok-4.3';
  if (![classifyModel,askModel].every(value=>typeof value==='string'&&value.trim()===value&&value.length>0)) throw new Error('Nonempty exact model identifiers required');
  return {classifyModel,askModel};
}
