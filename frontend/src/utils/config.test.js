import { DEFAULT_ARTICLES, MAX_ARTICLES, clampArticleCount } from './config';
test('development retrieval defaults to one and clamps the count', () => {
 expect(DEFAULT_ARTICLES).toBe(1); expect(MAX_ARTICLES).toBe(1);
 expect(clampArticleCount(15)).toBe(1); expect(clampArticleCount(0)).toBe(1);
});
test('approved one-article cap cannot be raised through environment',()=>{
 const previous=process.env.REACT_APP_MAX_ARTICLES;process.env.REACT_APP_MAX_ARTICLES='2';
 jest.isolateModules(()=>{const config=require('./config');expect(config.MAX_ARTICLES).toBe(1);expect(config.clampArticleCount(2)).toBe(1);});
 if(previous===undefined)delete process.env.REACT_APP_MAX_ARTICLES;else process.env.REACT_APP_MAX_ARTICLES=previous;
});
