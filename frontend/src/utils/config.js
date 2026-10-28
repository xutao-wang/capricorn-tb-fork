const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
export const MAX_ARTICLES = 1;
export const DEFAULT_ARTICLES = Math.min(positiveInteger(process.env.REACT_APP_DEFAULT_ARTICLES, 1), MAX_ARTICLES);
export const clampArticleCount = value => Math.min(positiveInteger(value, DEFAULT_ARTICLES), MAX_ARTICLES);
