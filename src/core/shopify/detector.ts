/**
 * Detects whether a website URL is a Shopify storefront by probing /products.json?limit=1
 * or inspecting known Shopify markers.
 */
export async function detectShopifyStore(
  url: string,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) return false;

  let origin: string;
  try {
    origin = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).origin;
  } catch {
    return false;
  }

  try {
    const probeUrl = `${origin}/products.json?limit=1`;
    const response = await fetchFn(probeUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json') || contentType.includes('text/json')) {
        const data = await response.json();
        if (data && Array.isArray(data.products)) {
          return true;
        }
      }
    }
  } catch {
    // Probe failed; not a public Shopify JSON endpoint
  }

  return false;
}
