const original = window.fetch.bind(window);
window.fetch = (input, options = {}) => {
  const url = new URL(input instanceof Request ? input.url : input, window.location.href);
  const method = (options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/') || ['GET','HEAD','OPTIONS'].includes(method)) return original(input, options);
  const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('X-Requested-With', 'Sendmidia');
  return original(input, { ...options, headers });
};
