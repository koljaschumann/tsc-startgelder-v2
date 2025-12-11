// /api/get-regatta.js
// Serverless Function zum Laden von Regatta-Details von manage2sail

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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

    // 1. Event-Seite laden (verschiedene Locales probieren)
    const locales = ['de-DE', 'en-US', 'de', 'en'];
    let eventHtml = null;
    let finalUrl = null;

    for (const locale of locales) {
      try {
        const testUrl = `https://www.manage2sail.com/${locale}/event/${eventSlug}`;
        const response = await fetch(testUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html',
            'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
          },
          redirect: 'follow'
        });

        if (response.ok) {
          const html = await response.text();
          // Prüfe ob echte Event-Seite (nicht Error oder Redirect)
          if (html.includes('event-') || html.includes('regatta') || html.includes('Classes') || html.includes('Klassen') || html.includes('Entries')) {
            eventHtml = html;
            finalUrl = testUrl;
            console.log('Found event at:', testUrl);
            break;
          }
        }
      } catch (e) {
        console.log(`Locale ${locale} failed:`, e.message);
      }
    }

    if (!eventHtml) {
      return res.status(404).json({ 
        error: 'Regatta nicht gefunden',
        slug: eventSlug,
        hint: 'Bitte prüfe den Link auf manage2sail.com'
      });
    }

    // 2. Event-Daten parsen
    const eventData = parseEventPage(eventHtml, eventSlug);
    console.log('Parsed event:', eventData.name, '| UUID:', eventData.eventUUID, '| Classes:', eventData.classes.length);

    // 3. Klassen-Daten laden (nur wenn UUID gefunden)
    const classesWithData = [];
    
    if (eventData.eventUUID && eventData.classes.length > 0) {
      // Parallel laden für Geschwindigkeit
      const classPromises = eventData.classes.slice(0, 10).map(classInfo => 
        loadClassData(eventData.eventUUID, classInfo).catch(err => {
          console.log(`Class ${classInfo.name} error:`, err.message);
          return null;
        })
      );
      
      const results = await Promise.all(classPromises);
      classesWithData.push(...results.filter(r => r && (r.entries?.length > 0 || r.results?.length > 0)));
    }

    // 4. Teilnehmer suchen
    let participant = null;
    if (sailNumber) {
      participant = findParticipant(classesWithData, sailNumber);
    }

    // 5. Gesamtstatistik
    const totalParticipants = classesWithData.reduce(
      (sum, c) => sum + Math.max(c.results?.length || 0, c.entries?.length || 0), 0
    );
    
    const maxRaceCount = Math.max(...classesWithData.map(c => c.raceCount || 0), 0);

    return res.status(200).json({
      success: true,
      event: {
        name: eventData.name,
        slug: eventSlug,
        uuid: eventData.eventUUID,
        date: eventData.date,
        place: eventData.place,
        url: finalUrl
      },
      classes: classesWithData.map(c => ({
        name: c.className,
        uuid: c.classUUID,
        entries: c.entries?.length || 0,
        results: c.results?.length || 0,
        raceCount: c.raceCount || 0
      })),
      participant,
      totalParticipants,
      raceCount: maxRaceCount,
      debug: {
        foundUUID: !!eventData.eventUUID,
        classesInHtml: eventData.classes.length,
        classesLoaded: classesWithData.length
      }
    });

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
    name: slug,
    eventUUID: null,
    date: null,
    place: '',
    classes: []
  };

  // Event-Name aus Title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    data.name = titleMatch[1]
      .replace(/\s*manage2sail\s*/gi, '')
      .replace(/\s*-\s*Register to the event.*$/i, '')
      .replace(/\s*-\s*$/,'')
      .trim();
  }

  // Event-UUID finden - verschiedene Patterns
  const uuidPatterns = [
    /eventId["']?\s*[:=]\s*["']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /data-event-id=["']([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/api\/event\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /"eventId":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i,
    /event\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  ];

  for (const pattern of uuidPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      data.eventUUID = match[1];
      break;
    }
  }

  // Falls Slug selbst eine UUID ist
  if (!data.eventUUID && slug.match(/^[0-9a-f]{8}-[0-9a-f]{4}/i)) {
    data.eventUUID = slug;
  }

  // Klassen-UUIDs finden
  const classPatterns = [
    /classId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    /regattaId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    /"classId":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi,
  ];

  const classUUIDs = new Set();
  for (const pattern of classPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      classUUIDs.add(match[1]);
    }
  }

  // Klassennamen extrahieren (falls verfügbar)
  const classesMap = new Map();
  
  // Suche nach Klassen-Links mit Namen
  const classLinkRegex = /href="[^"]*classId=([0-9a-f-]{36})[^"]*"[^>]*>([^<]+)/gi;
  let match;
  while ((match = classLinkRegex.exec(html)) !== null) {
    const uuid = match[1];
    const name = match[2].trim();
    if (name && name.length < 60 && !classesMap.has(uuid)) {
      classesMap.set(uuid, { uuid, name });
    }
  }

  // Verbleibende UUIDs ohne Namen
  for (const uuid of classUUIDs) {
    if (!classesMap.has(uuid)) {
      classesMap.set(uuid, { uuid, name: `Klasse` });
    }
  }

  data.classes = Array.from(classesMap.values());

  // Datum extrahieren
  const datePatterns = [
    /(\d{2})\.(\d{2})\.(\d{4})/,
    /(\d{2})\/(\d{2})\/(\d{4})/,
    /(\d{4})-(\d{2})-(\d{2})/,
  ];
  
  for (const pattern of datePatterns) {
    const dateMatch = html.match(pattern);
    if (dateMatch) {
      if (pattern.source.startsWith('(\\d{4})')) {
        // YYYY-MM-DD Format
        data.date = dateMatch[0];
      } else {
        // DD.MM.YYYY oder DD/MM/YYYY
        data.date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
      }
      break;
    }
  }

  return data;
}

async function loadClassData(eventUUID, classInfo) {
  const result = {
    className: classInfo.name,
    classUUID: classInfo.uuid,
    entries: [],
    results: [],
    raceCount: 0
  };

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'de-DE,de;q=0.9'
  };

  // Entries laden
  try {
    const entriesUrl = `https://www.manage2sail.com/api/event/${eventUUID}/regattaentry?regattaId=${classInfo.uuid}`;
    const entriesResponse = await fetch(entriesUrl, { headers });

    if (entriesResponse.ok) {
      const data = await entriesResponse.json();
      result.entries = data.Entries || data.entries || [];
      if (data.RegattaName || data.regattaName) {
        result.className = data.RegattaName || data.regattaName;
      }
    }
  } catch (err) {
    // Entries optional
  }

  // Results laden
  try {
    const resultsUrl = `https://www.manage2sail.com/api/event/${eventUUID}/regattaresult/${classInfo.uuid}`;
    const resultsResponse = await fetch(resultsUrl, { headers });

    if (resultsResponse.ok) {
      const data = await resultsResponse.json();
      result.results = data.Results || data.results || data.Entries || [];
      
      // Wettfahrten zählen
      if (data.Races || data.races) {
        result.raceCount = (data.Races || data.races).length;
      } else if (result.results[0]?.RaceResults) {
        result.raceCount = result.results[0].RaceResults.length;
      } else if (result.results[0]?.raceResults) {
        result.raceCount = result.results[0].raceResults.length;
      }
    }
  } catch (err) {
    // Results optional
  }

  return result;
}

function findParticipant(classesWithData, sailNumber) {
  // Normalisiere Segelnummer
  const sailClean = sailNumber.replace(/\s+/g, '').toUpperCase();
  const sailNumbersOnly = sailNumber.replace(/[^0-9]/g, '');
  
  for (const classData of classesWithData) {
    // Kombiniere Entries und Results
    const allEntries = [...(classData.entries || []), ...(classData.results || [])];
    
    for (const entry of allEntries) {
      const entrySail = (entry.SailNumber || entry.sailNumber || '').replace(/\s+/g, '').toUpperCase();
      
      // Verschiedene Match-Strategien
      const isMatch = 
        entrySail === sailClean ||
        entrySail.endsWith(sailNumbersOnly) ||
        (sailNumbersOnly.length >= 3 && entrySail.includes(sailNumbersOnly));
      
      if (isMatch) {
        // Finde zugehöriges Result
        const resultEntry = classData.results?.find(r => {
          const rSail = (r.SailNumber || r.sailNumber || '').replace(/\s+/g, '');
          return rSail.includes(sailNumbersOnly);
        });
        
        return {
          sailNumber: entry.SailNumber || entry.sailNumber,
          skipperName: entry.SkipperName || entry.skipperName || entry.HelmName || entry.helmName || entry.Name || entry.name,
          crew: entry.Crew || entry.crew || entry.CrewName || entry.crewName || '',
          club: entry.ClubName || entry.clubName || entry.Club || entry.club || '',
          boatName: entry.BoatName || entry.boatName || '',
          className: classData.className,
          rank: resultEntry?.Rank || resultEntry?.rank || resultEntry?.Position || resultEntry?.position || entry.Rank || entry.rank,
          totalPoints: resultEntry?.Total || resultEntry?.total || resultEntry?.TotalPoints,
          netPoints: resultEntry?.Net || resultEntry?.net || resultEntry?.NetPoints,
          raceCount: classData.raceCount
        };
      }
    }
  }
  
  return null;
}
