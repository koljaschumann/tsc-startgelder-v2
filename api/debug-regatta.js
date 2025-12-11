// /api/debug-regatta.js
// Gibt die rohe manage2sail API-Response zurück für Debugging

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { eventUUID, classUUID } = req.query;

  if (!eventUUID) {
    return res.status(400).json({ error: 'eventUUID parameter required' });
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'de-DE,de;q=0.9'
  };

  const results = {
    eventUUID,
    classUUID,
    timestamp: new Date().toISOString(),
    apis: {}
  };

  // 1. Event-Seite laden um alle UUIDs zu finden
  try {
    const eventUrl = `https://www.manage2sail.com/de-DE/event/${eventUUID}`;
    const eventResponse = await fetch(eventUrl, { headers: { ...headers, Accept: 'text/html' } });
    
    if (eventResponse.ok) {
      const html = await eventResponse.text();
      
      // Alle UUIDs extrahieren
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
      const allUUIDs = [...new Set((html.match(uuidRegex) || []).map(u => u.toLowerCase()))];
      
      results.foundUUIDs = allUUIDs;
      results.htmlLength = html.length;
      
      // Title extrahieren
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      results.eventTitle = titleMatch ? titleMatch[1] : null;
    }
  } catch (e) {
    results.eventPageError = e.message;
  }

  // 2. Wenn classUUID gegeben, lade Entries und Results
  if (classUUID) {
    // Entries API
    try {
      const entriesUrl = `https://www.manage2sail.com/api/event/${eventUUID}/regattaentry?regattaId=${classUUID}`;
      results.apis.entriesUrl = entriesUrl;
      
      const entriesResponse = await fetch(entriesUrl, { headers });
      results.apis.entriesStatus = entriesResponse.status;
      
      if (entriesResponse.ok) {
        const text = await entriesResponse.text();
        try {
          const data = JSON.parse(text);
          results.apis.entriesData = {
            keys: Object.keys(data),
            regattaName: data.RegattaName || data.regattaName,
            entriesCount: (data.Entries || data.entries || []).length,
            // Erste 2 Entries komplett für Struktur-Analyse
            sampleEntries: (data.Entries || data.entries || []).slice(0, 2)
          };
        } catch (e) {
          results.apis.entriesParseError = e.message;
          results.apis.entriesRawPreview = text.substring(0, 500);
        }
      }
    } catch (e) {
      results.apis.entriesError = e.message;
    }

    // Results API
    try {
      const resultsUrl = `https://www.manage2sail.com/api/event/${eventUUID}/regattaresult/${classUUID}`;
      results.apis.resultsUrl = resultsUrl;
      
      const resultsResponse = await fetch(resultsUrl, { headers });
      results.apis.resultsStatus = resultsResponse.status;
      
      if (resultsResponse.ok) {
        const text = await resultsResponse.text();
        try {
          const data = JSON.parse(text);
          results.apis.resultsData = {
            keys: Object.keys(data),
            regattaName: data.RegattaName || data.regattaName,
            raceCount: data.RaceCount,
            resultsCount: (data.Results || data.results || []).length,
            entryResultsCount: (data.EntryResults || []).length,
            scoringResultsCount: (data.ScoringResults || []).length,
            racesCount: (data.Races || data.races || [])?.length,
            // Sample von EntryResults - das sind vermutlich die echten Ergebnisse!
            sampleEntryResults: (data.EntryResults || []).slice(0, 3),
            // Sample von ScoringResults
            sampleScoringResults: (data.ScoringResults || []).slice(0, 2),
            // Alte Felder
            sampleResults: (data.Results || data.results || []).slice(0, 2),
            sampleRaces: (data.Races || data.races || []).slice(0, 2),
            // RaceNames für Wettfahrten
            raceNames: data.RaceNames,
            // Discards (Streicher)
            discards: data.Discards
          };
        } catch (e) {
          results.apis.resultsParseError = e.message;
          results.apis.resultsRawPreview = text.substring(0, 500);
        }
      }
    } catch (e) {
      results.apis.resultsError = e.message;
    }
  } else {
    // Ohne classUUID: Teste alle gefundenen UUIDs
    results.apis.testedClasses = [];
    
    for (const uuid of (results.foundUUIDs || []).slice(0, 5)) {
      if (uuid === eventUUID.toLowerCase()) continue;
      
      try {
        const entriesUrl = `https://www.manage2sail.com/api/event/${eventUUID}/regattaentry?regattaId=${uuid}`;
        const entriesResponse = await fetch(entriesUrl, { headers });
        
        if (entriesResponse.ok) {
          const text = await entriesResponse.text();
          if (text.startsWith('{')) {
            const data = JSON.parse(text);
            if (data.Entries || data.entries) {
              results.apis.testedClasses.push({
                classUUID: uuid,
                regattaName: data.RegattaName || data.regattaName,
                entriesCount: (data.Entries || data.entries || []).length,
                sampleEntry: (data.Entries || data.entries || [])[0]
              });
            }
          }
        }
      } catch (e) {
        // Skip
      }
    }
  }

  return res.status(200).json(results);
}
