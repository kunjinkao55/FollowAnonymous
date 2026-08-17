/**
 * Base contract for a platform provider.
 * Subclasses implement: static platform/label, detect(), parseUrl(), fetchRecent().
 */
class BaseProvider {
  static platform = 'base';
  static label = '通用';

  /** Whether this provider handles the given profile URL. */
  static detect() {
    throw new Error('not implemented');
  }

  /**
   * Parse a URL into { platform, uid, name }.
   * Throws an Error with a human-readable message when the URL cannot be parsed.
   */
  static parseUrl() {
    throw new Error('not implemented');
  }

  /**
   * Fetch the latest posts of a profile as a guest/anonymous visitor.
   * Returns { posts: [normalizedPost], name: string | null }.
   * Throw ProviderError with a message when the content is not anonymously reachable.
   */
  async fetchRecent() {
    throw new Error('not implemented');
  }
}

class ProviderError extends Error {
  constructor(message, { code = 'PROVIDER_ERROR' } = {}) {
    super(message);
    this.code = code;
    this.providerError = true;
  }
}

/** Convert a possibly object-author into a display string. */
function toAuthorString(author) {
  if (typeof author === 'string') return author;
  if (author && typeof author === 'object') {
    return String(
      author.nickname || author.screen_name || author.user?.nickname || author.name || ''
    );
  }
  return String(author || '');
}

/** Normalize a post into the common shape (all DB-bound fields coerced to strings). */
function normalizePost({ id, postId, author, content, publishedAt, postUrl, media = [] }) {
  return {
    postId: String(id ?? postId ?? ''),
    author: toAuthorString(author),
    content: typeof content === 'string' ? content : String(content == null ? '' : content),
    publishedAt: publishedAt ? String(new Date(publishedAt).toISOString()) : null,
    postUrl: typeof postUrl === 'string' ? postUrl : String(postUrl == null ? '' : postUrl),
    media: Array.isArray(media) ? media : [],
  };
}

module.exports = { BaseProvider, ProviderError, normalizePost, toAuthorString };