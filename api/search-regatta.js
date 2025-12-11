// /api/search-regatta.js
// Serverless Function zum Suchen von Regatten auf manage2sail
// Nutzt Bing als Suchproxy, da manage2sail per JavaScript lädt

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { query, year } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Query parameter required' });
  }

  try {
    const searchYear = year || new Date().getFullYear();
    const results = [];
    
    // Methode 1: Bing Web Search
    const bingResults = await searchViaBing(query, searchYear);
    results.push(...bingResults);
    
    // Methode 2: DuckDuckGo als Backup
    if (results.length === 0) {
      const ddgResults = await searchViaDuckDuckGo(query, searchYear);
      results.push(...ddgResults);
    }
    
    // Methode 3: Direkte Slug-Versuche
    if (results.length === 0) {
      const directResults = await tryDirectSlugs(query, searchYear);
      results.push(...directResults);
    }

    // Duplikate entfernen
    const uniqueResults = removeDuplicates(results);
    
    return res.status(200).json({
      success: true,
      query,
      year: searchYear,
      results: uniqueResults.slice(0, 15),
      hint: uniqueResults.length === 0 
        ? 'Keine Ergebnisse. Bitte kopiere den Link direkt von manage2sail.com' 
        : null
    });

  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ 
      error: 'Fehler bei der Suche', 
      details: error.message,
      hint: 'Bitte kopiere den Link direkt von manage2sail.com'
    });
  }
}

// Suche über Bing
async function searchViaBing(query, year) {
  const results = [];
  
  try {
    const searchQuery = encodeURIComponent(`site:manage2sail.com "${query}" ${year}`);
    const bingUrl = `https://www.bing.com/search?q=${searchQuery}&count=20`;
    
    const response = await fetch(bingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
      }
    });
    
    if (response.ok) {
      const html = await response.text();
      
      // Extrahiere manage2sail Links aus Bing-Ergebnissen
      // Pattern für URLs in href oder als Text
      const urlPatterns = [
        /href="(https?:\/\/(?:www\.)?manage2sail\.com\/[a-z-]+\/event\/([^"/?]+))"/gi,
        /(https?:\/\/(?:www\.)?manage2sail\.com\/[a-z-]+\/event\/([^\s"<]+))/gi
      ];
      
      const seen = new Set();
      
      for (const pattern of urlPatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          const url = match[1];
          let slug = match[2];
          
          // Bereinige Slug
          slug = slug.replace(/['"<>]/g, '').split(/[?#]/)[0];
          
          if (!seen.has(slug.toLowerCase()) && slug.length > 2 && slug.length < 100) {
            seen.add(slug.toLowerCase());
            
            // Versuche den Namen aus dem HTML zu extrahieren
            const namePattern = new RegExp(`>([^<]*${query}[^<]*)<`, 'i');
            const nameMatch = html.match(namePattern);
            
            results.push({
              slug,
              name: nameMatch ? cleanName(nameMatch[1]) : formatSlugAsName(slug),
              year: year.toString(),
              url: url.startsWith('http') ? url : `https://www.manage2sail.com/de-DE/event/${slug}`,
              source: 'bing'
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('Bing search error:', e.message);
  }
  
  return results;
}

// Suche über DuckDuckGo HTML
async function searchViaDuckDuckGo(query, year) {
  const results = [];
  
  try {
    const searchQuery = encodeURIComponent(`site:manage2sail.com ${query} ${year}`);
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${searchQuery}`;
    
    const response = await fetch(ddgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      }
    });
    
    if (response.ok) {
      const html = await response.text();
      
      // DuckDuckGo zeigt URLs in result__url class
      const urlRegex = /manage2sail\.com\/[a-z-]+\/event\/([a-zA-Z0-9_-]+)/gi;
      const seen = new Set();
      let match;
      
      while ((match = urlRegex.exec(html)) !== null) {
        const slug = match[1];
        
        if (!seen.has(slug.toLowerCase()) && slug.length > 2) {
          seen.add(slug.toLowerCase());
          
          results.push({
            slug,
            name: formatSlugAsName(slug),
            year: year.toString(),
            url: `https://www.manage2sail.com/de-DE/event/${slug}`,
            source: 'ddg'
          });
        }
      }
    }
  } catch (e) {
    console.error('DuckDuckGo search error:', e.message);
  }
  
  return results;
}

// Direkte Slug-Versuche basierend auf dem Suchbegriff
async function tryDirectSlugs(query, year) {
  const results = [];
  const possibleSlugs = generatePossibleSlugs(query, year);
  
  // Maximal 5 Versuche um nicht zu lange zu dauern
  for (const slug of possibleSlugs.slice(0, 5)) {
    try {
      const url = `https://www.manage2sail.com/de-DE/event/${slug}`;
      const response = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'manual'
      });
      
      // 200 = gefunden, 3xx = redirect (auch oft gültig)
      if (response.status === 200 || (response.status >= 300 && response.status < 400)) {
        results.push({
          slug,
          name: formatSlugAsName(slug),
          year: year.toString(),
          url,
          source: 'direct'
        });
      }
    } catch (e) {
      // Weiter versuchen
    }
  }
  
  return results;
}

// Generiert mögliche Slug-Varianten
function generatePossibleSlugs(query, year) {
  const slugs = [];
  const clean = query.trim();
  const yearShort = year.toString().slice(-2);
  
  // Entferne Sonderzeichen für Slug
  const slugBase = clean
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss');
  
  // Verschiedene Formate
  const noSpaces = slugBase.replace(/[\s-]+/g, '');
  const withDashes = slugBase.replace(/\s+/g, '-');
  const camelCase = slugBase.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  
  // Mit Jahr (kurz und lang)
  slugs.push(`${noSpaces}${year}`);
  slugs.push(`${noSpaces}${yearShort}`);
  slugs.push(`${camelCase}${year}`);
  slugs.push(`${camelCase}${yearShort}`);
  slugs.push(`${withDashes}-${year}`);
  slugs.push(`${withDashes}${yearShort}`);
  
  // Lowercase Varianten
  slugs.push(...slugs.map(s => s.toLowerCase()));
  
  // Abkürzungen (erste Buchstaben + Jahr)
  const initials = clean.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase()).join('');
  if (initials.length >= 2) {
    slugs.push(`${initials}${yearShort}`);
    slugs.push(`${initials}${year}`);
    slugs.push(`${initials.toLowerCase()}${yearShort}`);
  }
  
  return [...new Set(slugs)];
}

function formatSlugAsName(slug) {
  // UUID? Dann nur "Regatta" zurückgeben
  if (slug.match(/^[0-9a-f]{8}-[0-9a-f]{4}/i)) {
    return 'Regatta (UUID)';
  }
  
  // Slug zu lesbarem Namen
  return slug
    .replace(/(\d{4})$/, ' $1')  // Jahr abtrennen
    .replace(/(\d{2})$/, ' 20$1') // Kurzes Jahr
    .replace(/([a-z])([A-Z])/g, '$1 $2') // CamelCase trennen
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(name) {
  return name
    .replace(/\s+/g, ' ')
    .replace(/manage2sail/gi, '')
    .replace(/\.\.\./g, '')
    .trim();
}

function removeDuplicates(results) {
  const seen = new Set();
  return results.filter(r => {
    const key = r.slug.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
