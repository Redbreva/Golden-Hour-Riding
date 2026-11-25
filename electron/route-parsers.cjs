// Zero-dependency parsers for GPX, TCX, and Garmin FIT route/activity files
const fs = require('node:fs');
const path = require('node:path');

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function parseGpx(text) {
  const nameMatch = text.match(/<(?:trk|rte|metadata)[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i)
    || text.match(/<name[^>]*>([\s\S]*?)<\/name>/i);
  const name = nameMatch ? decodeXmlEntities(nameMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) : '';

  const points = [];
  // Prefer <trkpt>, fall back to <rtept> if no trackpoints exist
  const extractPoints = (tag) => {
    const rx = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>|<${tag}\\b([^>]*)\\/>`, 'gi');
    let m;
    while ((m = rx.exec(text)) !== null) {
      const attrs = m[1] || m[3] || '';
      const body = m[2] || '';
      const latM = attrs.match(/\blat\s*=\s*["']([^"']+)["']/i);
      const lonM = attrs.match(/\blon\s*=\s*["']([^"']+)["']/i);
      if (!latM || !lonM) continue;
      const lat = parseFloat(latM[1]);
      const lon = parseFloat(lonM[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const eleM = body.match(/<ele[^>]*>([^<]+)<\/ele>/i);
      const ele = eleM ? parseFloat(eleM[1]) : null;
      points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
    }
  };

  extractPoints('trkpt');
  if (points.length < 2) {
    points.length = 0;
    extractPoints('rtept');
  }
  return { name, points };
}

function parseTcx(text) {
  const nameMatch = text.match(/<Course[^>]*>[\s\S]*?<Name[^>]*>([\s\S]*?)<\/Name>/i)
    || text.match(/<Name[^>]*>([\s\S]*?)<\/Name>/i);
  const name = nameMatch ? decodeXmlEntities(nameMatch[1]) : '';

  const points = [];
  const rx = /<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/gi;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const body = m[1];
    const latM = body.match(/<LatitudeDegrees[^>]*>([^<]+)<\/LatitudeDegrees>/i);
    const lonM = body.match(/<LongitudeDegrees[^>]*>([^<]+)<\/LongitudeDegrees>/i);
    if (!latM || !lonM) continue;
    const lat = parseFloat(latM[1]);
    const lon = parseFloat(lonM[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleM = body.match(/<AltitudeMeters[^>]*>([^<]+)<\/AltitudeMeters>/i);
    const ele = eleM ? parseFloat(eleM[1]) : null;
    points.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }
  return { name, points };
}

// Self-contained Garmin FIT binary decoder (extracts record lat/lon/altitude & course name)
function parseFit(buf) {
  if (buf.length < 14) throw new Error('FIT file is too small');
  const headerSize = buf.readUInt8(0);
  const dataSize = buf.readUInt32LE(4);
  const sig = buf.toString('ascii', 8, 12);
  if (sig !== '.FIT') throw new Error('Invalid FIT file signature');

  const endOffset = Math.min(buf.length, headerSize + dataSize);
  let pos = headerSize;
  const defs = new Map();
  const points = [];
  let name = '';

  const SEMICIRCLE_TO_DEG = 180 / 2147483648; // 180 / 2^31

  function readFieldValue(offset, size, baseType, littleEndian) {
    const typeId = baseType & 0x1f;
    if (offset + size > buf.length) return null;
    switch (typeId) {
      case 1: return buf.readInt8(offset);
      case 2: return buf.readUInt8(offset);
      case 3: return size >= 2 ? (littleEndian ? buf.readInt16LE(offset) : buf.readInt16BE(offset)) : null;
      case 4: return size >= 2 ? (littleEndian ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset)) : null;
      case 5: return size >= 4 ? (littleEndian ? buf.readInt32LE(offset) : buf.readInt32BE(offset)) : null;
      case 6: return size >= 4 ? (littleEndian ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset)) : null;
      case 7: {
        let end = offset;
        while (end < offset + size && buf[end] !== 0) end++;
        return buf.toString('utf8', offset, end).trim();
      }
      case 8: return size >= 4 ? (littleEndian ? buf.readFloatLE(offset) : buf.readFloatBE(offset)) : null;
      default: return null;
    }
  }

  while (pos < endOffset) {
    const recordHeader = buf.readUInt8(pos++);

    // Compressed timestamp header (bit 7 = 1)
    if ((recordHeader & 0x80) !== 0) {
      const localMesg = (recordHeader >> 5) & 0x03;
      const def = defs.get(localMesg);
      if (!def) break;
      pos = readDataRecord(def, pos);
      continue;
    }

    const isDefinition = (recordHeader & 0x40) !== 0;
    const hasDevFields = (recordHeader & 0x20) !== 0;
    const localMesg = recordHeader & 0x0f;

    if (isDefinition) {
      if (pos + 5 > endOffset) break;
      pos++; // reserved
      const arch = buf.readUInt8(pos++); // 0 = LE, 1 = BE
      const littleEndian = arch === 0;
      const globalMesg = littleEndian ? buf.readUInt16LE(pos) : buf.readUInt16BE(pos);
      pos += 2;
      const numFields = buf.readUInt8(pos++);
      const fields = [];
      let totalSize = 0;
      for (let i = 0; i < numFields; i++) {
        if (pos + 3 > endOffset) break;
        const fieldNum = buf.readUInt8(pos++);
        const size = buf.readUInt8(pos++);
        const baseType = buf.readUInt8(pos++);
        fields.push({ fieldNum, size, baseType, offset: totalSize });
        totalSize += size;
      }
      if (hasDevFields && pos < endOffset) {
        const numDev = buf.readUInt8(pos++);
        for (let i = 0; i < numDev; i++) {
          if (pos + 3 > endOffset) break;
          pos++; // dev field num
          const devSize = buf.readUInt8(pos++);
          pos++; // dev data index
          totalSize += devSize;
        }
      }
      defs.set(localMesg, { globalMesg, littleEndian, fields, totalSize });
    } else {
      const def = defs.get(localMesg);
      if (!def) break;
      pos = readDataRecord(def, pos);
    }
  }

  function readDataRecord(def, start) {
    if (start + def.totalSize > endOffset) return endOffset;
    if (def.globalMesg === 20) {
      // FIT record message
      let lat = null;
      let lon = null;
      let alt = null;
      let enhAlt = null;
      for (const f of def.fields) {
        if (f.fieldNum === 0) {
          const v = readFieldValue(start + f.offset, f.size, f.baseType, def.littleEndian);
          if (v !== null && v !== 0x7fffffff) lat = v * SEMICIRCLE_TO_DEG;
        } else if (f.fieldNum === 1) {
          const v = readFieldValue(start + f.offset, f.size, f.baseType, def.littleEndian);
          if (v !== null && v !== 0x7fffffff) lon = v * SEMICIRCLE_TO_DEG;
        } else if (f.fieldNum === 2) {
          const v = readFieldValue(start + f.offset, f.size, f.baseType, def.littleEndian);
          if (v !== null && v !== 0xffff) alt = v / 5 - 500;
        } else if (f.fieldNum === 78) {
          const v = readFieldValue(start + f.offset, f.size, f.baseType, def.littleEndian);
          if (v !== null && v !== 0xffffffff) enhAlt = v / 5 - 500;
        }
      }
      if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        points.push({ lat, lon, ele: enhAlt !== null ? enhAlt : alt });
      }
    } else if (def.globalMesg === 31 && !name) {
      // FIT course message: field 5 = name
      for (const f of def.fields) {
        if (f.fieldNum === 5) {
          const v = readFieldValue(start + f.offset, f.size, f.baseType, def.littleEndian);
          if (typeof v === 'string' && v.length) name = v;
        }
      }
    }
    return start + def.totalSize;
  }

  return { name, points };
}

function parseRouteFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, ext).replace(/[_-]+/g, ' ').trim();
  let parsed;
  if (ext === '.fit') {
    parsed = parseFit(fs.readFileSync(filePath));
  } else if (ext === '.tcx') {
    parsed = parseTcx(fs.readFileSync(filePath, 'utf8'));
  } else if (ext === '.gpx') {
    parsed = parseGpx(fs.readFileSync(filePath, 'utf8'));
  } else {
    throw new Error(`Unsupported file format "${ext}". Please choose a .gpx, .fit, or .tcx file.`);
  }

  if (!parsed.points || parsed.points.length < 2) {
    throw new Error('No GPS track points found in this file.');
  }

  return {
    name: parsed.name || baseName || 'Imported Route',
    points: parsed.points,
  };
}

module.exports = { parseRouteFile, parseGpx, parseTcx, parseFit };
