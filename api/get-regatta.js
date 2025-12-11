// /api/get-regatta.js
// Serverless Function zum Laden von Regatta-Details von manage2sail
// Verbesserte Version mit robuster UUID-Extraktion und Segelnummer-Matching

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

    console.log('Loading regatta:', eventSlug, '| sailNumber:', sailNumber);

    // 1. Event-Seite laden
    const { html: eventHtml, finalUrl } = await loadEventPage(eventSlug);
    
    if (!eventHtml) {
      return res.status(404).json({ 
        error: 'Regatta nicht gefunden',
        slug: eventSlug
      });
    }

    // 2. Event-Daten und alle möglichen UUIDs parsen
    const eventData = parseEventPage(eventHtml, eventSlug);
    console.log('Event:', eventData.name, '| UUID:', eventData.eventUUID, '| Potential class UUIDs:', eventData.allUUIDs.length);

    // 3. Für jede potenzielle UUID versuchen, Klassen-Daten zu laden
    const classesWithData = [];
    const testedUUIDs = new Set();
    
    // Wenn wir eine Event-UUID haben
    const eventUUID = eventData.eventUUID || eventSlug;
    
    // Alle gefundenen UUIDs als potenzielle Klassen testen
    for (const potentialClassUUID of eventData.allUUIDs) {
      if (testedUUIDs.has(potentialClassUUID)) continue;
      if (potentialClassUUID === eventUUID) continue; // Event-UUID überspringen
      testedUUIDs.add(potentialClassUUID);
      
      try {
        const classData = await loadClassData(eventUUID, potentialClassUUID);
        if (classData && (classData.entries?.length > 0 || classData.results?.length > 0)) {
          classesWithData.push(classData);
          console.log('Found class:', classData.className, '| Entries:', classData.entries?.length, '| Results:', classData.results?.length);
        }
      } catch (err) {
        // UUID war keine Klasse, ignorieren
      }
      
      // Max 15 Klassen testen um Timeout zu vermeiden
      if (classesWithData.length >= 15) break;
    }

    // 4. Teilnehmer suchen
    let participant = null;
    if (sailNumber) {
      participant = findParticipant(classesWithData, sailNumber);
      console.log('Participant found:', participant ? 'yes' : 'no');
    }

    // 5. Statistiken
    const totalParticipants = classesWithData.reduce(
      (sum, c) => sum + Math.max(c.results?.length || 0, c.entries?.length || 0), 0
    );
    
    const maxRaceCount = Math.max(...classesWithData.map(c => c.raceCount || 0), 0);

    return res.status(200).json({
      success: true,
      event: {
        name: eventData.name,
        slug: eventSlug,
        uuid: eventUUID,
        date: eventData.date,
        url: finalUrl
      },
      classes: classesWithData.map(c => ({
        name: c.className,
        uuid: c.classUUID,
        entries: c.entries?.length || 0,
        results: c.results?.length || 0,
        raceCount: c.raceCount || 0,
        debug: c.debug
      })),
      participant,
      totalParticipants,
      raceCount: maxRaceCount,
      debug: {
        eventUUID,
        uuidsFound: eventData.allUUIDs.length,
        uuidsTested: testedUUIDs.size,
        classesFound: classesWithData.length,
        classNames: classesWithData.map(c => c.className),
        participantDebug: participant?.debug
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

async function loadEventPage(eventSlug) {
  const locales = ['de-DE', 'en-US', 'de', 'en', 'no'];
  
  for (const locale of locales) {
    try {
      const testUrl = `https://www.manage2sail.com/${locale}/event/${eventSlug}`;
      console.log('Trying:', testUrl);
      
      const response = await fetch(testUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
        },
        redirect: 'follow'
      });

      if (response.ok) {
        const html = await response.text();
        // Prüfe ob echte Event-Seite
        if (html.length > 1000 && (html.includes('manage2sail') || html.includes('event'))) {
          return { html, finalUrl: testUrl };
        }
      }
    } catch (e) {
      console.log(`Locale ${locale} failed:`, e.message);
    }
  }
  
  return { html: null, finalUrl: null };
}

function parseEventPage(html, slug) {
  const data = {
    name: slug,
    eventUUID: null,
    date: null,
    allUUIDs: []
  };

  // Event-Name aus Title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    data.name = titleMatch[1]
      .replace(/\s*manage2sail\s*/gi, '')
      .replace(/\s*-\s*Register.*$/i, '')
      .trim();
  }

  // ALLE UUIDs im HTML finden
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const allMatches = html.match(uuidRegex) || [];
  
  // Unique UUIDs sammeln
  const uniqueUUIDs = [...new Set(allMatches.map(u => u.toLowerCase()))];
  data.allUUIDs = uniqueUUIDs;

  // Event-UUID identifizieren (häufig erste UUID oder in bestimmten Patterns)
  const eventUUIDPatterns = [
    /eventId["']?\s*[:=]\s*["']?([0-9a-f-]{36})/i,
    /\/event\/([0-9a-f-]{36})/i,
    /"eventId":"([0-9a-f-]{36})"/i,
  ];

  for (const pattern of eventUUIDPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      data.eventUUID = match[1].toLowerCase();
      break;
    }
  }

  // Falls Slug selbst eine UUID ist
  if (!data.eventUUID && slug.match(/^[0-9a-f]{8}-[0-9a-f]{4}/i)) {
    data.eventUUID = slug.toLowerCase();
  }

  // Falls immer noch keine Event-UUID, nimm die erste gefundene
  if (!data.eventUUID && uniqueUUIDs.length > 0) {
    data.eventUUID = uniqueUUIDs[0];
  }

  // Datum extrahieren
  const dateMatch = html.match(/(\d{2})[./](\d{2})[./](\d{4})/);
  if (dateMatch) {
    data.date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  }

  return data;
}

async function loadClassData(eventUUID, classUUID) {
  const result = {
    className: 'Unbekannte Klasse',
    classUUID: classUUID,
    entries: [],
    results: [],
    raceCount: 0,
    debug: {}
  };

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'de-DE,de;q=0.9'
  };

  // Entries laden
  try {
    const entriesUrl = `https://www.manage2sail.com/api/event/${eventUUID}/regattaentry?regattaId=${classUUID}`;
    const entriesResponse = await fetch(entriesUrl, { headers });

    if (entriesResponse.ok) {
      const text = await entriesResponse.text();
      if (text && text.startsWith('{')) {
        const data = JSON.parse(text);
        result.entries = data.Entries || data.entries || [];
        if (data.RegattaName || data.regattaName) {
          result.className = data.RegattaName || data.regattaName;
        }
        result.debug.entriesKeys = Object.keys(data);
      }
    }
  } catch (err) {
    result.debug.entriesError = err.message;
  }

  // Results laden
  try {
    const resultsUrl = `https://www.manage2sail.com/api/event/${eventUUID}/regattaresult/${classUUID}`;
    const resultsResponse = await fetch(resultsUrl, { headers });

    if (resultsResponse.ok) {
      const text = await resultsResponse.text();
      if (text && text.startsWith('{')) {
        const data = JSON.parse(text);
        result.results = data.Results || data.results || [];
        result.debug.resultsKeys = Object.keys(data);
        
        // Klassenname aus Results falls nicht aus Entries
        if (result.className === 'Unbekannte Klasse' && (data.RegattaName || data.regattaName)) {
          result.className = data.RegattaName || data.regattaName;
        }
        
        // Wettfahrten zählen - verschiedene Möglichkeiten
        if (data.Races) {
          result.raceCount = data.Races.length;
          result.debug.racesSource = 'Races array';
        } else if (data.races) {
          result.raceCount = data.races.length;
          result.debug.racesSource = 'races array';
        } else if (data.RaceCount) {
          result.raceCount = data.RaceCount;
          result.debug.racesSource = 'RaceCount field';
        } else if (data.raceCount) {
          result.raceCount = data.raceCount;
          result.debug.racesSource = 'raceCount field';
        } else if (result.results[0]?.RaceResults) {
          result.raceCount = result.results[0].RaceResults.length;
          result.debug.racesSource = 'RaceResults[0] length';
        } else if (result.results[0]?.raceResults) {
          result.raceCount = result.results[0].raceResults.length;
          result.debug.racesSource = 'raceResults[0] length';
        }
        
        // Debug: Erste Result-Eintrag Struktur
        if (result.results[0]) {
          result.debug.firstResultKeys = Object.keys(result.results[0]);
          result.debug.firstResultSample = {
            SailNumber: result.results[0].SailNumber,
            sailNumber: result.results[0].sailNumber,
            Rank: result.results[0].Rank,
            rank: result.results[0].rank,
            Position: result.results[0].Position,
            position: result.results[0].position,
            Place: result.results[0].Place,
            place: result.results[0].place,
            Platz: result.results[0].Platz,
            platz: result.results[0].platz
          };
        }
      }
    }
  } catch (err) {
    result.debug.resultsError = err.message;
  }

  return result;
}

function findParticipant(classesWithData, sailNumber) {
  // Normalisiere Segelnummer - entferne Leerzeichen und Ländercode für numerischen Vergleich
  const sailClean = sailNumber.replace(/\s+/g, '').toUpperCase();
  const sailNumbersOnly = sailNumber.replace(/[^0-9]/g, '');
  
  console.log('Searching for sail:', sailClean, '| numbers only:', sailNumbersOnly);
  
  for (const classData of classesWithData) {
    // Zuerst in Results suchen (haben Platzierung)
    if (classData.results && classData.results.length > 0) {
      for (const entry of classData.results) {
        const entrySail = (entry.SailNumber || entry.sailNumber || '').replace(/\s+/g, '').toUpperCase();
        const entrySailNumbers = entrySail.replace(/[^0-9]/g, '');
        
        // Verschiedene Match-Strategien
        const isMatch = 
          entrySail === sailClean ||
          entrySailNumbers === sailNumbersOnly ||
          (sailNumbersOnly.length >= 4 && entrySail.endsWith(sailNumbersOnly)) ||
          (sailNumbersOnly.length >= 4 && entrySailNumbers === sailNumbersOnly);
        
        if (isMatch) {
          console.log('Match found in results:', entrySail);
          console.log('Entry keys:', Object.keys(entry));
          
          // Platzierung aus verschiedenen möglichen Feldern extrahieren
          const rank = entry.Rank || entry.rank || 
                      entry.Position || entry.position || 
                      entry.Place || entry.place ||
                      entry.Platz || entry.platz ||
                      entry.FinalRank || entry.finalRank ||
                      entry.OverallRank || entry.overallRank ||
                      null;
          
          console.log('Extracted rank:', rank);
          
          // Wettfahrten aus dem Eintrag
          let raceCount = classData.raceCount;
          if (entry.RaceResults) {
            raceCount = entry.RaceResults.length;
          } else if (entry.raceResults) {
            raceCount = entry.raceResults.length;
          } else if (entry.Races) {
            raceCount = entry.Races.length;
          }
          
          // Zusätzliche Infos aus Entries holen
          const entryData = classData.entries?.find(e => {
            const eSail = (e.SailNumber || e.sailNumber || '').replace(/\s+/g, '');
            return eSail.includes(sailNumbersOnly);
          });
          
          return {
            sailNumber: entry.SailNumber || entry.sailNumber,
            skipperName: entry.SkipperName || entry.skipperName || entry.HelmName || entry.helmName || 
                        entry.Name || entry.name ||
                        entryData?.SkipperName || entryData?.skipperName || '',
            crew: entry.Crew || entry.crew || entry.CrewName || entry.crewName ||
                  entryData?.Crew || entryData?.crew || '',
            club: entry.ClubName || entry.clubName || entry.Club || entry.club ||
                  entryData?.ClubName || entryData?.clubName || '',
            boatName: entry.BoatName || entry.boatName || entryData?.BoatName || '',
            className: classData.className,
            rank: rank,
            totalPoints: entry.Total || entry.total || entry.TotalPoints || entry.totalPoints || entry.Points || entry.points,
            netPoints: entry.Net || entry.net || entry.NetPoints || entry.netPoints,
            raceCount: raceCount,
            totalInClass: classData.results.length,
            debug: {
              allKeys: Object.keys(entry),
              rankFields: { Rank: entry.Rank, rank: entry.rank, Position: entry.Position, Place: entry.Place }
            }
          };
        }
      }
    }
    
    // Falls nicht in Results gefunden, in Entries suchen
    if (classData.entries && classData.entries.length > 0) {
      for (const entry of classData.entries) {
        const entrySail = (entry.SailNumber || entry.sailNumber || '').replace(/\s+/g, '').toUpperCase();
        const entrySailNumbers = entrySail.replace(/[^0-9]/g, '');
        
        const isMatch = 
          entrySail === sailClean ||
          entrySailNumbers === sailNumbersOnly ||
          (sailNumbersOnly.length >= 4 && entrySail.endsWith(sailNumbersOnly));
        
        if (isMatch) {
          console.log('Match found in entries:', entrySail);
          
          return {
            sailNumber: entry.SailNumber || entry.sailNumber,
            skipperName: entry.SkipperName || entry.skipperName || entry.HelmName || '',
            crew: entry.Crew || entry.crew || entry.CrewName || '',
            club: entry.ClubName || entry.clubName || entry.Club || '',
            boatName: entry.BoatName || entry.boatName || '',
            className: classData.className,
            rank: null, // Keine Ergebnisse
            raceCount: classData.raceCount,
            totalInClass: classData.entries.length
          };
        }
      }
    }
  }
  
  // Debug: Alle gefundenen Segelnummern ausgeben
  console.log('No match found. Available sail numbers in all classes:');
  for (const classData of classesWithData) {
    const sails = [...(classData.results || []), ...(classData.entries || [])]
      .map(e => e.SailNumber || e.sailNumber)
      .filter(Boolean)
      .slice(0, 5);
    console.log(`  ${classData.className}:`, sails.join(', '));
  }
  
  return null;
}
