import { describe, expect, it } from 'vitest';
import {
  isSiteEnabled,
  matchingRules,
  parseRule,
  ruleMatches,
  suggestRule,
} from '../src/lib/site-rules';
import { migrateSiteRules } from '../src/lib/site-migration';

class FakeSync {
  data: Record<string, unknown>;
  constructor(data: Record<string, unknown>) {
    this.data = data;
  }
  async get(keys: string[]) {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = this.data[k];
    return out;
  }
  async set(v: Record<string, unknown>) {
    Object.assign(this.data, v);
  }
  async remove(keys: string | string[]) {
    for (const k of [keys].flat()) delete this.data[k];
  }
}

describe('migrateSiteRules', () => {
  it('update without siteMode: disabledHosts → blocklist + blockRules', async () => {
    const s = new FakeSync({ disabledHosts: ['old.example.com', 'x.cn'] });
    expect(await migrateSiteRules(s, 'update')).toBe('migrated');
    expect(s.data.siteMode).toBe('blocklist');
    expect(s.data.blockRules).toEqual(['old.example.com', 'x.cn']);
    expect('disabledHosts' in s.data).toBe(false);
  });

  it('update with siteMode already set → skipped, nothing removed', async () => {
    const s = new FakeSync({
      siteMode: 'allowlist',
      disabledHosts: ['a.com'],
    });
    expect(await migrateSiteRules(s, 'update')).toBe('skipped');
    expect(s.data.disabledHosts).toEqual(['a.com']);
  });

  it('update with no disabledHosts → blocklist, empty rules', async () => {
    const s = new FakeSync({});
    expect(await migrateSiteRules(s, 'update')).toBe('migrated');
    expect(s.data.blockRules).toEqual([]);
  });

  it('install → noop, defaults stay', async () => {
    const s = new FakeSync({ disabledHosts: ['a.com'] });
    expect(await migrateSiteRules(s, 'install')).toBe('noop');
    expect(s.data.siteMode).toBeUndefined();
    expect(s.data.disabledHosts).toEqual(['a.com']);
  });
});

const ok = (input: string) => {
  const r = parseRule(input);
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('parseRule', () => {
  it('bare host', () => {
    expect(ok('example.com').text).toBe('example.com');
    expect(ok('example.com').rule).toEqual({ host: 'example.com', path: '' });
  });

  it('strips scheme, leading *., port, query and hash', () => {
    expect(ok('https://example.com').text).toBe('example.com');
    expect(ok('http://example.com/news').text).toBe('example.com/news');
    expect(ok('*.example.com').text).toBe('example.com');
    expect(ok('*.example.com/').text).toBe('example.com');
    expect(ok('example.com:8080').text).toBe('example.com');
    expect(ok('127.0.0.1:3000/x?y=1#z').text).toBe('127.0.0.1/x');
    expect(ok('example.com/?a=b').text).toBe('example.com');
  });

  it('lowercases host, keeps path case', () => {
    expect(ok('EXAMPLE.com/News').text).toBe('example.com/News');
  });

  it('IDN host normalizes to punycode', () => {
    expect(ok('中文.example.com').rule.host).toBe('xn--fiq228c.example.com');
  });

  it('path trailing slash removed; lone / becomes host-only', () => {
    expect(ok('example.com/news/').text).toBe('example.com/news');
    expect(ok('example.com/').text).toBe('example.com');
    expect(ok('example.com/news//').text).toBe('example.com/news');
  });

  it('localhost and IPv4 are valid', () => {
    expect(ok('localhost').rule.host).toBe('localhost');
    expect(ok('192.168.1.1').rule.host).toBe('192.168.1.1');
  });

  it('rejects empty and invalid input', () => {
    expect(parseRule('')).toEqual({ error: '请输入网址或域名' });
    expect(parseRule('   ')).toEqual({ error: '请输入网址或域名' });
    expect(parseRule('not a host')).toEqual({ error: '无法识别这个域名' });
    expect(parseRule('bad_host.com')).toEqual({ error: '无法识别这个域名' });
    expect(parseRule('.example.com')).toEqual({ error: '无法识别这个域名' });
    expect(parseRule('example.com.')).toEqual({ error: '无法识别这个域名' });
    expect(parseRule('/news')).toEqual({ error: '无法识别这个域名' });
  });
});

describe('ruleMatches', () => {
  const R = (t: string) => ok(t).rule;
  it('host matches itself and subdomains, not suffix strings', () => {
    expect(ruleMatches(R('example.com'), new URL('https://example.com/'))).toBe(
      true,
    );
    expect(
      ruleMatches(R('example.com'), new URL('https://news.example.com/a')),
    ).toBe(true);
    expect(ruleMatches(R('example.com'), new URL('https://notexample.com/')))
      .toBe(false);
    expect(
      ruleMatches(R('news.example.com'), new URL('https://example.com/')),
    ).toBe(false);
  });

  it('path is a prefix on segment boundary', () => {
    const r = R('example.com/news');
    expect(ruleMatches(r, new URL('https://example.com/news'))).toBe(true);
    expect(ruleMatches(r, new URL('https://example.com/news/'))).toBe(true);
    expect(ruleMatches(r, new URL('https://example.com/news/a'))).toBe(true);
    expect(ruleMatches(r, new URL('https://example.com/newsletter'))).toBe(
      false,
    );
    expect(ruleMatches(r, new URL('https://example.com/'))).toBe(false);
    expect(ruleMatches(r, new URL('https://sub.example.com/news'))).toBe(true);
  });

  it('non-http URLs never match', () => {
    expect(ruleMatches(R('example.com'), new URL('file:///x'))).toBe(false);
    expect(
      ruleMatches(R('extensions'), new URL('chrome://extensions')),
    ).toBe(false);
  });
});

describe('matchingRules / isSiteEnabled', () => {
  const rules = ['example.com', 'sub.test.org/sect', 'not a host'];
  it('returns matching canonical texts only', () => {
    expect(matchingRules(rules, 'https://www.example.com/a')).toEqual([
      'example.com',
    ]);
    expect(matchingRules(rules, 'https://sub.test.org/sect/x')).toEqual([
      'sub.test.org/sect',
    ]);
    expect(matchingRules(rules, 'https://sub.test.org/other')).toEqual([]);
  });

  it('allowlist: only matching URLs enabled', () => {
    expect(
      isSiteEnabled('https://example.com/', 'allowlist', rules),
    ).toBe(true);
    expect(isSiteEnabled('https://other.com/', 'allowlist', rules)).toBe(
      false,
    );
    expect(isSiteEnabled('https://other.com/', 'allowlist', [])).toBe(false);
  });

  it('blocklist: non-matching URLs enabled', () => {
    expect(isSiteEnabled('https://example.com/', 'blocklist', rules)).toBe(
      false,
    );
    expect(isSiteEnabled('https://other.com/', 'blocklist', rules)).toBe(true);
    expect(isSiteEnabled('https://other.com/', 'blocklist', [])).toBe(true);
  });

  it('non-http(s) never enabled', () => {
    expect(isSiteEnabled('chrome://extensions', 'blocklist', [])).toBe(false);
    expect(isSiteEnabled('file:///tmp/x.html', 'allowlist', ['*'])).toBe(false);
    expect(isSiteEnabled('not a url', 'blocklist', [])).toBe(false);
  });
});

describe('suggestRule', () => {
  it('site: hostname with one leading www. removed', () => {
    expect(suggestRule('https://www.example.com/a/b', 'site')).toBe(
      'example.com',
    );
    expect(suggestRule('https://news.example.com/', 'site')).toBe(
      'news.example.com',
    );
    expect(suggestRule('http://www2.example.com/', 'site')).toBe(
      'www2.example.com',
    );
  });

  it('section: only directory-like paths produce a rule', () => {
    expect(suggestRule('https://www.example.com/news/a?x=1', 'section')).toBe(
      'example.com/news',
    );
    expect(suggestRule('https://example.com/news/', 'section')).toBe(
      'example.com/news',
    );
    expect(suggestRule('https://example.com/', 'section')).toBeNull();
    expect(suggestRule('https://example.com', 'section')).toBeNull();
    expect(suggestRule('https://example.com/fixture.html', 'section')).toBeNull();
    expect(suggestRule('https://example.com/article', 'section')).toBeNull();
    expect(suggestRule('https://example.com/a/b/c', 'section')).toBe(
      'example.com/a',
    );
  });

  it('non-http → null', () => {
    expect(suggestRule('chrome://extensions', 'site')).toBeNull();
    expect(suggestRule('nope', 'site')).toBeNull();
  });
});
