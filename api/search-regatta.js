// /api/search-regatta.js
// Serverless Function zum Suchen von Regatten auf manage2sail

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query, year } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter required' });
  }

  try {
    // Suche auf manage2sail Event-Seite
    const searchYear = year || new Date().getFullYear();
    const searchUrl = `https://www.manage2sail.com/de-DE/event?year=${searchYear}`;
    
    console.log('Fetching manage2sail events page...');
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`manage2sail returned ${response.status}`);
    }

    const html = await response.text();
    
    // Parse die Event-Tabelle
    const events = parseEventsFromHtml(html, query.toLowerCase());
    
    return res.status(200).json({
      success: true,
      query,
      year: searchYear,
      results: events.slice(0, 20) // Max 20 Ergebnisse
    });

  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ 
      error: 'Fehler bei der Suche', 
      details: error.message 
    });
  }
}

function parseEventsFromHtml(html, searchQuery) {
  const events = [];
  
  // Finde alle Event-Links in der Tabelle
  // Format: <a href="/de-DE/event/eventslug">Event Name</a>
  const eventLinkRegex = /<tr[^>]*>[\s\S]*?<td[^>]*>(\d{4})<\/td>[\s\S]*?<td[^>]*>(\d{2}\.\d{2}\.)<\/td>[\s\S]*?<td[^>]*>(\d{2}\.\d{2}\.)<\/td>[\s\S]*?<a\s+href="\/[^/]+\/event\/([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<td[^>]*>[^<]*<\/td>[\s\S]*?<td[^>]*>([A-Z]{3})?<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>[\s\S]*?<\/tr>/gi;
  
  let match;
  while ((match = eventLinkRegex.exec(html)) !== null) {
    const [, year, fromDate, toDate, slug, name, country, place] = match;
    
    // Filter nach Suchbegriff
    const searchableText = `${name} ${place || ''} ${slug}`.toLowerCase();
    if (searchableText.includes(searchQuery)) {
      events.push({
        slug,
        name: name.trim(),
        year,
        fromDate: fromDate.trim(),
        toDate: toDate.trim(),
        country: country || 'GER',
        place: place?.trim() || '',
        url: `https://www.manage2sail.com/de-DE/event/${slug}`
      });
    }
  }
  
  // Fallback: Einfachere Regex wenn obige nichts findet
  if (events.length === 0) {
    const simpleLinkRegex = /href="\/[^/]+\/event\/([^"]+)"[^>]*>([^<]+)</gi;
    while ((match = simpleLinkRegex.exec(html)) !== null) {
      const [, slug, name] = match;
      if (name.toLowerCase().includes(searchQuery) || slug.toLowerCase().includes(searchQuery)) {
        events.push({
          slug,
          name: name.trim(),
          url: `https://www.manage2sail.com/de-DE/event/${slug}`
        });
      }
    }
  }
  
  return events;
}
