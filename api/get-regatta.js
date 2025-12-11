// /api/get-regatta.js
// Serverless Function zum Laden aller Regatta-Details von manage2sail

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { slug, url, sailNumber } = req.query;

  if (!slug && !url) {
    return res.status(400).json({ error: 'slug or url parameter required' });
  }

  try {
    // Event-Slug aus URL extrahieren falls nötig
    let eventSlug = slug;
    if (!eventSlug && url) {
      const urlMatch = url.match(/\/event\/([^/?#]+)/);
      if (urlMatch) eventSlug = urlMatch[1];
    }

    if (!eventSlug) {
      return res.status(400).json({ error: 'Could not extract event slug' });
    }

    console.log('Loading regatta:', eventSlug);

    // 1. Event-Seite laden um UUID zu bekommen
    const eventUrl = `https://www.manage2sail.com/de-DE/event/${eventSlug}`;
    const eventResponse = await fetch(eventUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!eventResponse.ok) {
      throw new Error(`Event page returned ${eventResponse.status}`);
    }

    const eventHtml = await eventResponse.text();
    
    // 2. Event-UUID und Klassen-UUIDs extrahieren
    const eventData = parseEventPage(eventHtml, eventSlug);
    
    if (!eventData.eventUUID) {
      // Versuche alternative Methode
      console.log('Trying alternative UUID extraction...');
      const altUUID = extractUUIDAlternative(eventHtml);
      if (altUUID) eventData.eventUUID = altUUID;
    }

    // 3. Für jede Klasse die Entries und Results laden
    const classesWithData = [];
    
    for (const classInfo of eventData.classes) {
      try {
        const classData = await loadClassData(eventData.eventUUID, classInfo);
        if (classData) {
          classesWithData.push(classData);
        }
      } catch (err) {
        console.error(`Error loading class ${classInfo.name}:`, err.message);
      }
    }

    // 4. Wenn sailNumber angegeben, den spezifischen Teilnehmer finden
    let participant = null;
    if (sailNumber) {
      const normalizedSail = sailNumber.replace(/\s+/g, '').toUpperCase();
      const sailNumberOnly = sailNumber.replace(/[^0-9]/g, '');
      
      for (const classData of classesWithData) {
        const found = classData.entries?.find(e => {
          const entrySail = (e.SailNumber || '').replace(/\s+/g, '').toUpperCase();
          return entrySail.includes(sailNumberOnly) || entrySail === normalizedSail;
        });
        
        if (found) {
          // Suche Platzierung in Results
          const result = classData.results?.find(r => 
            r.SailNumber?.includes(sailNumberOnly)
          );
          
          participant = {
            sailNumber: found.SailNumber,
            skipperName: found.SkipperName,
            crew: found.Crew,
            club: found.ClubName,
            boatName: found.BoatName,
            boatType: found.BoatType,
            className: classData.className,
            rank: result?.Rank || null,
            totalPoints: result?.Total || null,
            netPoints: result?.Net || null
          };
          break;
        }
      }
    }

    // 5. Gesamtergebnis zusammenstellen
    const result = {
      success: true,
      event: {
        name: eventData.name,
        slug: eventSlug,
        uuid: eventData.eventUUID,
        date: eventData.date,
        place: eventData.place,
        club: eventData.club,
        url: eventUrl
      },
      classes: classesWithData.map(c => ({
        name: c.className,
        uuid: c.classUUID,
        totalEntries: c.entries?.length || 0,
        totalResults: c.results?.length || 0,
        raceCount: c.raceCount || 0
      })),
      participant,
      totalParticipants: classesWithData.reduce((sum, c) => sum + (c.results?.length || c.entries?.length || 0), 0)
    };

    return res.status(200).json(result);

  } catch (error) {
    console.error('Get regatta error:', error);
    return res.status(500).json({ 
      error: 'Fehler beim Laden der Regatta', 
      details: error.message 
    });
  }
}

function parseEventPage(html, slug) {
  const data = {
    name: '',
    eventUUID: null,
    date: null,
    place: '',
    club: '',
    classes: []
  };

  // Event-Name aus Title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    data.name = titleMatch[1].replace(' manage2sail', '').trim();
  }

  // Event-UUID aus verschiedenen Stellen suchen
  // Pattern 1: In JavaScript/Data-Attributen
  const uuidPatterns = [
    /eventId['":\s]+['"]?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /data-event-id=['"]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/api\/event\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /event\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  ];

  for (const pattern of uuidPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.eventUUID = match[1];
      break;
    }
  }

  // Klassen-UUIDs suchen
  // Pattern: /api/event/{eventUUID}/regattaentry?regattaId={classUUID}
  // oder: /#!entries?classId={classUUID}
  const classPatterns = [
    /classId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[^>]*>([^<]*)/gi,
    /regattaId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
  ];

  const foundClasses = new Map();
  
  // Suche nach Klassen-Links
  const classLinkRegex = /#!(?:entries|results)\?classId=([0-9a-f-]{36})[^>]*>(?:<[^>]+>)*([^<]+)/gi;
  let match;
  while ((match = classLinkRegex.exec(html)) !== null) {
    const uuid = match[1];
    const name = match[2].trim();
    if (name && !foundClasses.has(uuid)) {
      foundClasses.set(uuid, { uuid, name });
    }
  }

  // Alternative: Aus Tabellen-Rows
  const tableRowRegex = /<td[^>]*>([^<]+)<\/td>[\s\S]*?classId=([0-9a-f-]{36})/gi;
  while ((match = tableRowRegex.exec(html)) !== null) {
    const name = match[1].trim();
    const uuid = match[2];
    if (name && !foundClasses.has(uuid)) {
      foundClasses.set(uuid, { uuid, name });
    }
  }

  data.classes = Array.from(foundClasses.values());

  // Datum extrahieren
  const dateMatch = html.match(/(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/);
  if (dateMatch) {
    data.date = `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`;
  }

  return data;
}

function extractUUIDAlternative(html) {
  // Suche in Script-Tags nach JSON-Daten
  const scriptMatch = html.match(/var\s+\w+\s*=\s*\{[^}]*['"](Id|UUID)['"]\s*:\s*['"]([0-9a-f-]{36})['"]/i);
  if (scriptMatch) return scriptMatch[2];
  
  // Suche in data-* Attributen
  const dataMatch = html.match(/data-[^=]*=['"]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})['"]/i);
  if (dataMatch) return dataMatch[1];
  
  return null;
}

async function loadClassData(eventUUID, classInfo) {
  if (!eventUUID) {
    console.log('No event UUID, skipping API calls');
    return { className: classInfo.name, classUUID: classInfo.uuid, entries: [], results: [] };
  }

  const result = {
    className: classInfo.name,
    classUUID: classInfo.uuid,
    entries: [],
    results: [],
    raceCount: 0
  };

  try {
    // Entries laden
    const entriesUrl = `https://www.manage2sail.com/api/event/${eventUUID}/regattaentry?regattaId=${classInfo.uuid}`;
    console.log('Loading entries:', entriesUrl);
    
    const entriesResponse = await fetch(entriesUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    if (entriesResponse.ok) {
      const entriesData = await entriesResponse.json();
      result.entries = entriesData.Entries || [];
      result.className = entriesData.RegattaName || classInfo.name;
    }
  } catch (err) {
    console.error('Entries error:', err.message);
  }

  try {
    // Results laden
    const resultsUrl = `https://www.manage2sail.com/api/event/${eventUUID}/regattaresult/${classInfo.uuid}`;
    console.log('Loading results:', resultsUrl);
    
    const resultsResponse = await fetch(resultsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    if (resultsResponse.ok) {
      const resultsData = await resultsResponse.json();
      result.results = resultsData.Results || resultsData.Entries || [];
      
      // Wettfahrten zählen
      if (resultsData.Races) {
        result.raceCount = resultsData.Races.length;
      } else if (result.results[0]?.RaceResults) {
        result.raceCount = result.results[0].RaceResults.length;
      }
    }
  } catch (err) {
    console.error('Results error:', err.message);
  }

  return result;
}
