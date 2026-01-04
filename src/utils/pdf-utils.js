/*
 * Copyright 2024 Joe Meszaros
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Basic PDF generator utility for creating multi-page PDF files with lines and text.
 * No external dependencies required.
 *
 * PDF coordinate system: origin at bottom-left, Y increases upward.
 * Units are in points (1 point = 1/72 inch, ~0.353mm)
 */

const MM_TO_PT = 72 / 25.4; // 1mm = 2.834645669 points

/**
 * Simple TrueType font parser to extract cmap and hmtx tables
 * This allows proper Unicode to Glyph ID mapping and glyph widths
 */
class TTFParser {
  constructor(data) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.offset = 0;
    this.tables = {};
    this.numGlyphs = 0;
    this.unitsPerEm = 1000;
  }

  readUint16(offset) {
    return this.view.getUint16(offset, false); // Big endian
  }

  readUint32(offset) {
    return this.view.getUint32(offset, false); // Big endian
  }

  readInt16(offset) {
    return this.view.getInt16(offset, false);
  }

  /**
   * Parse table directory to find table offsets
   */
  parseTableDirectory() {
    const numTables = this.readUint16(4);
    for (let i = 0; i < numTables; i++) {
      const tableOffset = 12 + i * 16;
      const tag =
        String.fromCharCode(this.data[tableOffset]) +
        String.fromCharCode(this.data[tableOffset + 1]) +
        String.fromCharCode(this.data[tableOffset + 2]) +
        String.fromCharCode(this.data[tableOffset + 3]);
      this.tables[tag] = {
        offset : this.readUint32(tableOffset + 8),
        length : this.readUint32(tableOffset + 12)
      };
    }
  }

  /**
   * Parse head and maxp tables for font metrics
   */
  parseMetrics() {
    // Parse head table for unitsPerEm
    if (this.tables['head']) {
      this.unitsPerEm = this.readUint16(this.tables['head'].offset + 18);
    }
    // Parse maxp table for numGlyphs
    if (this.tables['maxp']) {
      this.numGlyphs = this.readUint16(this.tables['maxp'].offset + 4);
    }
  }

  /**
   * Parse hmtx table to get glyph widths
   * @returns {Map<number, number>} Glyph ID -> width in font units
   */
  parseGlyphWidths() {
    const widths = new Map();

    if (!this.tables['hmtx'] || !this.tables['hhea']) {
      return widths;
    }

    // Get numberOfHMetrics from hhea table
    const numberOfHMetrics = this.readUint16(this.tables['hhea'].offset + 34);
    const hmtxOffset = this.tables['hmtx'].offset;

    // Read long horizontal metrics (advanceWidth + leftSideBearing)
    for (let i = 0; i < numberOfHMetrics; i++) {
      const advanceWidth = this.readUint16(hmtxOffset + i * 4);
      // Convert to 1000 units per em (PDF standard)
      const pdfWidth = Math.round((advanceWidth * 1000) / this.unitsPerEm);
      widths.set(i, pdfWidth);
    }

    // Remaining glyphs use the last advanceWidth
    if (numberOfHMetrics > 0) {
      const lastWidth = widths.get(numberOfHMetrics - 1);
      for (let i = numberOfHMetrics; i < this.numGlyphs; i++) {
        widths.set(i, lastWidth);
      }
    }

    return widths;
  }

  /**
   * Parse the font and extract Unicode to GlyphID mapping
   * @returns {Map<number, number>} Unicode code point -> Glyph ID
   */
  parseUnicodeMap() {
    this.parseTableDirectory();
    this.parseMetrics();

    const unicodeToGlyph = new Map();

    try {
      if (!this.tables['cmap']) {
        console.warn('No cmap table found in font');
        return unicodeToGlyph;
      }

      const cmapOffset = this.tables['cmap'].offset;

      // Parse cmap table
      const numSubtables = this.readUint16(cmapOffset + 2);

      // Find Unicode subtable (platform 3, encoding 1 for BMP, or platform 0)
      let subtableOffset = 0;
      for (let i = 0; i < numSubtables; i++) {
        const recordOffset = cmapOffset + 4 + i * 8;
        const platformId = this.readUint16(recordOffset);
        const encodingId = this.readUint16(recordOffset + 2);
        const offset = this.readUint32(recordOffset + 4);

        // Prefer platform 3 encoding 1 (Windows Unicode BMP) or platform 0 (Unicode)
        if ((platformId === 3 && encodingId === 1) || (platformId === 0 && encodingId === 3)) {
          subtableOffset = cmapOffset + offset;
          break;
        }
        // Fallback to any Unicode encoding
        if (platformId === 0 || platformId === 3) {
          subtableOffset = cmapOffset + offset;
        }
      }

      if (subtableOffset === 0) {
        console.warn('No Unicode cmap subtable found');
        return unicodeToGlyph;
      }

      // Parse subtable based on format
      const format = this.readUint16(subtableOffset);

      if (format === 4) {
        // Format 4: Segment mapping to delta values (most common for BMP)
        this.parseCmapFormat4(subtableOffset, unicodeToGlyph);
      } else if (format === 12) {
        // Format 12: Segmented coverage (supports full Unicode)
        this.parseCmapFormat12(subtableOffset, unicodeToGlyph);
      } else {
        console.warn('Unsupported cmap format:', format);
      }
    } catch (e) {
      console.error('Error parsing font cmap:', e);
    }

    return unicodeToGlyph;
  }

  parseCmapFormat4(offset, unicodeToGlyph) {
    const segCount = this.readUint16(offset + 6) / 2;
    const endCodesOffset = offset + 14;
    const startCodesOffset = endCodesOffset + segCount * 2 + 2; // +2 for reservedPad
    const idDeltaOffset = startCodesOffset + segCount * 2;
    const idRangeOffsetOffset = idDeltaOffset + segCount * 2;

    for (let i = 0; i < segCount; i++) {
      const endCode = this.readUint16(endCodesOffset + i * 2);
      const startCode = this.readUint16(startCodesOffset + i * 2);
      const idDelta = this.readInt16(idDeltaOffset + i * 2);
      const idRangeOffset = this.readUint16(idRangeOffsetOffset + i * 2);

      if (startCode === 0xffff) break;

      for (let charCode = startCode; charCode <= endCode; charCode++) {
        let glyphId;
        if (idRangeOffset === 0) {
          glyphId = (charCode + idDelta) & 0xffff;
        } else {
          const glyphIdOffset = idRangeOffsetOffset + i * 2 + idRangeOffset + (charCode - startCode) * 2;
          glyphId = this.readUint16(glyphIdOffset);
          if (glyphId !== 0) {
            glyphId = (glyphId + idDelta) & 0xffff;
          }
        }
        if (glyphId !== 0) {
          unicodeToGlyph.set(charCode, glyphId);
        }
      }
    }
  }

  parseCmapFormat12(offset, unicodeToGlyph) {
    const numGroups = this.readUint32(offset + 12);
    const groupsOffset = offset + 16;

    for (let i = 0; i < numGroups; i++) {
      const groupOffset = groupsOffset + i * 12;
      const startCharCode = this.readUint32(groupOffset);
      const endCharCode = this.readUint32(groupOffset + 4);
      const startGlyphId = this.readUint32(groupOffset + 8);

      for (let charCode = startCharCode; charCode <= endCharCode; charCode++) {
        const glyphId = startGlyphId + (charCode - startCharCode);
        unicodeToGlyph.set(charCode, glyphId);
      }
    }
  }
}

/**
 * Simple PDF document generator with Unicode support
 */
export class PDFDocument {
  constructor(options = {}) {
    this.pageWidth = options.width || 595.28; // A4 width in points
    this.pageHeight = options.height || 841.89; // A4 height in points
    this.pages = [];
    this.currentPage = null;
    this.objects = [];
    this.objectOffsets = [];
    this.nextObjectId = 1;

    // Font resources
    this.fonts = {
      Helvetica : null // Will be assigned object ID when needed
    };

    // Embedded font data
    this.embeddedFont = null;
    this.embeddedFontName = 'EmbeddedFont';

    // ExtGState resources for opacity
    this.extGStates = new Map(); // opacity value -> ExtGState name
    this.extGStateCounter = 0;

    // Unicode to Glyph ID mapping (parsed from font)
    this.unicodeToGlyph = null;
    // Glyph ID to width mapping (parsed from font)
    this.glyphWidths = null;

    // Image resources: array of { data: Uint8Array, width: number, height: number, name: string }
    this.images = [];
    this.imageCounter = 0;
  }

  /**
   * Add a JPEG image to the document
   * @param {Uint8Array} jpegData - Raw JPEG data
   * @param {number} width - Image width in pixels
   * @param {number} height - Image height in pixels
   * @returns {string} Image name (e.g., "Im1") to use when drawing
   */
  addImage(jpegData, width, height) {
    this.imageCounter++;
    const name = `Im${this.imageCounter}`;
    this.images.push({ data: jpegData, width, height, name });
    return name;
  }

  /**
   * Load and embed a TrueType font from URL for Unicode support
   * @param {string} url - URL to the TTF/OTF font file
   * @returns {Promise<void>}
   */
  async loadFont(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch font: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      this.embeddedFont = new Uint8Array(arrayBuffer);
      console.log(`Font loaded: ${this.embeddedFont.length} bytes`);

      // Parse font to extract Unicode to GlyphID mapping and glyph widths
      const parser = new TTFParser(this.embeddedFont);
      this.unicodeToGlyph = parser.parseUnicodeMap();
      this.glyphWidths = parser.parseGlyphWidths();
      console.log(
        `Parsed ${this.unicodeToGlyph.size} character mappings and ${this.glyphWidths.size} glyph widths from font`
      );
    } catch (error) {
      console.error('Failed to load font:', error);
      throw error;
    }
  }

  /**
   * Set embedded font data directly
   * @param {Uint8Array} fontData - TrueType font data
   */
  setFontData(fontData) {
    this.embeddedFont = fontData;
  }

  /**
   * Get or create an ExtGState for a specific opacity value
   * @param {number} opacity - Opacity value (0-1)
   * @returns {string} The ExtGState name (e.g., 'GS1')
   */
  getOrCreateOpacityExtGState(opacity) {
    // Round opacity to 2 decimal places to avoid too many states
    const roundedOpacity = Math.round(opacity * 100) / 100;
    const key = roundedOpacity.toString();

    if (this.extGStates.has(key)) {
      return this.extGStates.get(key).name;
    }

    this.extGStateCounter++;
    const name = `GS${this.extGStateCounter}`;
    this.extGStates.set(key, { name, opacity: roundedOpacity });
    return name;
  }

  /**
   * Add a new page to the document
   * @param {Object} options - Page options (width, height in points)
   * @returns {PDFPage} The new page
   */
  addPage(options = {}) {
    const page = new PDFPage({
      width    : options.width || this.pageWidth,
      height   : options.height || this.pageHeight,
      document : this
    });
    this.pages.push(page);
    this.currentPage = page;
    return page;
  }

  /**
   * Get the current page
   * @returns {PDFPage}
   */
  getPage() {
    if (!this.currentPage) {
      this.addPage();
    }
    return this.currentPage;
  }

  /**
   * Generate the PDF file as a Blob
   * @returns {Blob}
   */
  toBlob() {
    const pdfContent = this.generate();
    return new Blob([pdfContent], { type: 'application/pdf' });
  }

  /**
   * Generate the PDF file as a data URL
   * @returns {string}
   */
  toDataURL() {
    const pdfContent = this.generate();
    // Convert Uint8Array to base64
    let binary = '';
    for (let i = 0; i < pdfContent.length; i++) {
      binary += String.fromCharCode(pdfContent[i]);
    }
    const base64 = btoa(binary);
    return `data:application/pdf;base64,${base64}`;
  }

  /**
   * Download the PDF file
   * @param {string} filename
   */
  save(filename = 'document.pdf') {
    const blob = this.toBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Generate the complete PDF content
   * @returns {string}
   */
  generate() {
    this.objects = [];
    this.nextObjectId = 1;

    // Use Uint8Array for binary content to handle font embedding
    const chunks = [];
    let currentOffset = 0;

    // Map of object ID -> byte offset (for xref table)
    const objectOffsetMap = new Map();

    // Helper to record object offset
    const recordOffset = (objId) => {
      objectOffsetMap.set(objId, currentOffset);
    };

    // Helper to add text and track actual byte length
    const addText = (text) => {
      const encoded = new TextEncoder().encode(text);
      chunks.push(encoded);
      currentOffset += encoded.length;
    };
    // For raw bytes (like binary markers), use Uint8Array directly
    const addRawBytes = (bytes) => {
      const arr = new Uint8Array(bytes);
      chunks.push(arr);
      currentOffset += arr.length;
    };
    const addBinary = (data) => {
      chunks.push(data);
      currentOffset += data.length;
    };

    addText('%PDF-1.4\n');
    // Binary marker to indicate this is a binary PDF (raw bytes, not UTF-8 encoded)
    addRawBytes([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]); // %âãÏÓ\n

    // Create fallback font object (Helvetica - built-in PDF font for F1)
    const fontObjId = this.nextObjectId++;
    this.fonts['Helvetica'] = fontObjId;
    recordOffset(fontObjId);
    const fontObj =
      `${fontObjId} 0 obj\n` +
      '<<\n' +
      '/Type /Font\n' +
      '/Subtype /Type1\n' +
      '/BaseFont /Helvetica\n' +
      '/Encoding /WinAnsiEncoding\n' +
      '>>\n' +
      'endobj\n';
    addText(fontObj);

    // Create embedded Unicode font (F2) if font data is available
    let unicodeFontObjId = null;
    if (this.embeddedFont) {
      // Create ToUnicode CMap
      const toUnicodeCMap = this.generateToUnicodeCMap();
      const toUnicodeObjId = this.nextObjectId++;
      recordOffset(toUnicodeObjId);
      const toUnicodeHeader =
        `${toUnicodeObjId} 0 obj\n` + '<<\n' + `/Length ${toUnicodeCMap.length}\n` + '>>\n' + 'stream\n';
      addText(toUnicodeHeader);
      addText(toUnicodeCMap);
      const toUnicodeFooter = '\nendstream\nendobj\n';
      addText(toUnicodeFooter);

      // Create font file stream (embedded TrueType font)
      const fontFileObjId = this.nextObjectId++;
      recordOffset(fontFileObjId);
      const fontFileHeader =
        `${fontFileObjId} 0 obj\n` +
        '<<\n' +
        `/Length ${this.embeddedFont.length}\n` +
        '/Length1 ' +
        this.embeddedFont.length +
        '\n' +
        '>>\n' +
        'stream\n';
      addText(fontFileHeader);
      addBinary(this.embeddedFont);
      const fontFileFooter = '\nendstream\nendobj\n';
      addText(fontFileFooter);

      // Create font descriptor
      const fontDescriptorObjId = this.nextObjectId++;
      recordOffset(fontDescriptorObjId);
      const fontDescriptor =
        `${fontDescriptorObjId} 0 obj\n` +
        '<<\n' +
        '/Type /FontDescriptor\n' +
        `/FontName /${this.embeddedFontName}\n` +
        '/Flags 4\n' +
        '/ItalicAngle 0\n' +
        '/Ascent 880\n' +
        '/Descent -120\n' +
        '/CapHeight 680\n' +
        '/StemV 80\n' +
        '/FontBBox [-1000 -1000 3000 2000]\n' +
        `/FontFile2 ${fontFileObjId} 0 R\n` +
        '>>\n' +
        'endobj\n';
      addText(fontDescriptor);

      // Create CIDFont with glyph widths
      // Note: We use glyph IDs directly in the text stream, so CIDToGIDMap /Identity works
      // because our text encoding outputs glyph IDs, not Unicode code points
      const cidFontObjId = this.nextObjectId++;
      recordOffset(cidFontObjId);

      // Build width array for CIDFont
      // Format: [startGlyph [w1 w2 w3 ...] startGlyph [w1 w2 ...] ...]
      let widthArray = '';
      if (this.glyphWidths && this.glyphWidths.size > 0) {
        // Group consecutive glyphs with their widths
        const sortedGlyphs = [...this.glyphWidths.entries()].sort((a, b) => a[0] - b[0]);
        let currentStart = -1;
        let currentWidths = [];

        for (const [glyphId, width] of sortedGlyphs) {
          if (currentStart === -1 || glyphId !== currentStart + currentWidths.length) {
            // Start new range
            if (currentWidths.length > 0) {
              widthArray += `${currentStart} [${currentWidths.join(' ')}] `;
            }
            currentStart = glyphId;
            currentWidths = [width];
          } else {
            currentWidths.push(width);
          }
        }
        // Add last range
        if (currentWidths.length > 0) {
          widthArray += `${currentStart} [${currentWidths.join(' ')}]`;
        }
      }

      let cidFont =
        `${cidFontObjId} 0 obj\n` +
        '<<\n' +
        '/Type /Font\n' +
        '/Subtype /CIDFontType2\n' +
        `/BaseFont /${this.embeddedFontName}\n` +
        `/FontDescriptor ${fontDescriptorObjId} 0 R\n` +
        '/CIDSystemInfo <<\n' +
        '/Registry (Adobe)\n' +
        '/Ordering (Identity)\n' +
        '/Supplement 0\n' +
        '>>\n' +
        '/DW 500\n'; // Default width for missing glyphs

      if (widthArray) {
        cidFont += `/W [${widthArray}]\n`;
      }

      cidFont += '/CIDToGIDMap /Identity\n' + '>>\n' + 'endobj\n';
      addText(cidFont);

      // Create Type0 font
      unicodeFontObjId = this.nextObjectId++;
      recordOffset(unicodeFontObjId);
      const type0Font =
        `${unicodeFontObjId} 0 obj\n` +
        '<<\n' +
        '/Type /Font\n' +
        '/Subtype /Type0\n' +
        `/BaseFont /${this.embeddedFontName}\n` +
        '/Encoding /Identity-H\n' +
        `/DescendantFonts [${cidFontObjId} 0 R]\n` +
        `/ToUnicode ${toUnicodeObjId} 0 R\n` +
        '>>\n' +
        'endobj\n';
      addText(type0Font);
    }

    // Create ExtGState objects for opacity
    const extGStateObjIds = new Map();
    for (const [, state] of this.extGStates) {
      const extGStateObjId = this.nextObjectId++;
      extGStateObjIds.set(state.name, extGStateObjId);

      recordOffset(extGStateObjId);
      const extGState =
        `${extGStateObjId} 0 obj\n` +
        '<<\n' +
        '/Type /ExtGState\n' +
        `/CA ${state.opacity.toFixed(2)}\n` +
        `/ca ${state.opacity.toFixed(2)}\n` +
        '>>\n' +
        'endobj\n';
      addText(extGState);
    }

    // Create image XObjects
    const imageObjIds = new Map(); // imageName -> objId
    for (const image of this.images) {
      const imageObjId = this.nextObjectId++;
      imageObjIds.set(image.name, imageObjId);

      recordOffset(imageObjId);
      const imageHeader =
        `${imageObjId} 0 obj\n` +
        '<<\n' +
        '/Type /XObject\n' +
        '/Subtype /Image\n' +
        `/Width ${image.width}\n` +
        `/Height ${image.height}\n` +
        '/ColorSpace /DeviceRGB\n' +
        '/BitsPerComponent 8\n' +
        '/Filter /DCTDecode\n' +
        `/Length ${image.data.length}\n` +
        '>>\n' +
        'stream\n';
      addText(imageHeader);
      addBinary(image.data);
      const imageFooter = '\nendstream\nendobj\n';
      addText(imageFooter);
    }

    // Create resources dictionary object
    const resourcesObjId = this.nextObjectId++;
    recordOffset(resourcesObjId);
    let resourcesDict = `${resourcesObjId} 0 obj\n` + '<<\n' + '/Font <<\n' + `/F1 ${fontObjId} 0 R\n`;

    // Add Unicode font to resources if embedded
    if (unicodeFontObjId) {
      resourcesDict += `/F2 ${unicodeFontObjId} 0 R\n`;
    }
    resourcesDict += '>>\n';

    // Add ExtGState resources if any opacity states were used
    if (extGStateObjIds.size > 0) {
      resourcesDict += '/ExtGState <<\n';
      for (const [name, objId] of extGStateObjIds) {
        resourcesDict += `/${name} ${objId} 0 R\n`;
      }
      resourcesDict += '>>\n';
    }

    // Add image XObject resources if any images were added
    if (imageObjIds.size > 0) {
      resourcesDict += '/XObject <<\n';
      for (const [name, objId] of imageObjIds) {
        resourcesDict += `/${name} ${objId} 0 R\n`;
      }
      resourcesDict += '>>\n';
    }

    resourcesDict += '>>\n' + 'endobj\n';
    addText(resourcesDict);

    // Create page objects
    const pageObjIds = [];
    const contentObjIds = [];

    for (const page of this.pages) {
      // Create content stream
      const contentStream = page.getContentStream();
      const contentObjId = this.nextObjectId++;
      contentObjIds.push(contentObjId);

      recordOffset(contentObjId);
      const contentObj =
        `${contentObjId} 0 obj\n` +
        '<<\n' +
        `/Length ${contentStream.length}\n` +
        '>>\n' +
        'stream\n' +
        contentStream +
        '\nendstream\n' +
        'endobj\n';
      addText(contentObj);

      // Create page object reference (actual object created after pagesObjId is known)
      const pageObjId = this.nextObjectId++;
      pageObjIds.push({ id: pageObjId, page, contentObjId });
    }

    // Create pages object (parent of all pages) - must be created before page objects
    // so we know the pagesObjId to reference as /Parent
    const pagesObjId = this.nextObjectId++;

    // Now create the actual page objects with /Parent reference
    for (const { id: pageObjId, page, contentObjId } of pageObjIds) {
      recordOffset(pageObjId);
      const pageObj =
        `${pageObjId} 0 obj\n` +
        '<<\n' +
        '/Type /Page\n' +
        `/Parent ${pagesObjId} 0 R\n` +
        `/MediaBox [0 0 ${page.width.toFixed(2)} ${page.height.toFixed(2)}]\n` +
        `/Resources ${resourcesObjId} 0 R\n` +
        `/Contents ${contentObjId} 0 R\n` +
        '>>\n' +
        'endobj\n';
      addText(pageObj);
    }
    recordOffset(pagesObjId);
    const pagesObj =
      `${pagesObjId} 0 obj\n` +
      '<<\n' +
      '/Type /Pages\n' +
      `/Kids [${pageObjIds.map((p) => `${p.id} 0 R`).join(' ')}]\n` +
      `/Count ${this.pages.length}\n` +
      '>>\n' +
      'endobj\n';
    addText(pagesObj);

    // Create catalog object
    const catalogObjId = this.nextObjectId++;
    recordOffset(catalogObjId);
    const catalogObj =
      `${catalogObjId} 0 obj\n` + '<<\n' + '/Type /Catalog\n' + `/Pages ${pagesObjId} 0 R\n` + '>>\n' + 'endobj\n';
    addText(catalogObj);

    // Cross-reference table
    const xrefOffset = currentOffset;
    let xref = 'xref\n';
    xref += `0 ${this.nextObjectId}\n`;
    xref += '0000000000 65535 f \n';

    // Write offsets in object ID order (1, 2, 3, ...)
    for (let objId = 1; objId < this.nextObjectId; objId++) {
      const offset = objectOffsetMap.get(objId);
      if (offset === undefined) {
        console.error(`Missing offset for object ${objId}`);
        xref += '0000000000 00000 n \n';
      } else {
        xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
      }
    }
    addText(xref);

    // Trailer
    const trailer =
      'trailer\n' +
      '<<\n' +
      `/Size ${this.nextObjectId}\n` +
      `/Root ${catalogObjId} 0 R\n` +
      '>>\n' +
      'startxref\n' +
      `${xrefOffset}\n` +
      '%%EOF';
    addText(trailer);

    // Combine all chunks into final binary output
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /**
   * Generate a ToUnicode CMap for identity mapping
   * This enables proper text extraction from the PDF
   * @returns {string}
   */
  generateToUnicodeCMap() {
    return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo <<
/Registry (Adobe)
/Ordering (UCS)
/Supplement 0
>> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfrange
<0000> <FFFF> <0000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  }
}

/**
 * Represents a single page in the PDF document
 */
class PDFPage {
  constructor(options) {
    this.width = options.width;
    this.height = options.height;
    this.document = options.document;
    this.operations = [];

    // Current graphics state
    this.strokeColor = { r: 0, g: 0, b: 0 };
    this.fillColor = { r: 0, g: 0, b: 0 };
    this.lineWidth = 1;
    this.fontSize = 12;
  }

  /**
   * Set the stroke (line) color
   * @param {number} r - Red (0-255 or 0-1)
   * @param {number} g - Green (0-255 or 0-1)
   * @param {number} b - Blue (0-255 or 0-1)
   */
  setStrokeColor(r, g, b) {
    // Normalize to 0-1 range
    if (r > 1 || g > 1 || b > 1) {
      r = r / 255;
      g = g / 255;
      b = b / 255;
    }
    this.strokeColor = { r, g, b };
    this.operations.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);
  }

  /**
   * Set the fill color
   * @param {number} r - Red (0-255 or 0-1)
   * @param {number} g - Green (0-255 or 0-1)
   * @param {number} b - Blue (0-255 or 0-1)
   */
  setFillColor(r, g, b) {
    // Normalize to 0-1 range
    if (r > 1 || g > 1 || b > 1) {
      r = r / 255;
      g = g / 255;
      b = b / 255;
    }
    this.fillColor = { r, g, b };
    this.operations.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
  }

  /**
   * Set the line width
   * @param {number} width - Line width in points
   */
  setLineWidth(width) {
    this.lineWidth = width;
    this.operations.push(`${width.toFixed(2)} w`);
  }

  /**
   * Set the stroke and fill opacity
   * @param {number} opacity - Opacity value (0-1)
   */
  setOpacity(opacity) {
    // In PDF, opacity is handled through ExtGState
    // We use the 'ca' operator for stroke opacity and 'CA' for fill opacity
    // However, inline opacity changes are complex in PDF, so we use a simpler approach
    // by setting both stroke and fill opacity via graphics state
    const extGStateName = this.document.getOrCreateOpacityExtGState(opacity);
    this.operations.push(`/${extGStateName} gs`);
  }

  /**
   * Draw a line from (x1, y1) to (x2, y2)
   * @param {number} x1 - Start X coordinate
   * @param {number} y1 - Start Y coordinate
   * @param {number} x2 - End X coordinate
   * @param {number} y2 - End Y coordinate
   */
  drawLine(x1, y1, x2, y2) {
    this.operations.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m`);
    this.operations.push(`${x2.toFixed(2)} ${y2.toFixed(2)} l`);
    this.operations.push('S');
  }

  /**
   * Begin a new path
   */
  beginPath() {
    // Path is started with the first moveTo
  }

  /**
   * Move to a point without drawing
   * @param {number} x
   * @param {number} y
   */
  moveTo(x, y) {
    this.operations.push(`${x.toFixed(2)} ${y.toFixed(2)} m`);
  }

  /**
   * Draw a line to a point
   * @param {number} x
   * @param {number} y
   */
  lineTo(x, y) {
    this.operations.push(`${x.toFixed(2)} ${y.toFixed(2)} l`);
  }

  /**
   * Stroke the current path
   */
  stroke() {
    this.operations.push('S');
  }

  /**
   * Fill the current path
   */
  fill() {
    this.operations.push('f');
  }

  /**
   * Close the current path
   */
  closePath() {
    this.operations.push('h');
  }

  /**
   * Draw a rectangle
   * @param {number} x - X coordinate of bottom-left corner
   * @param {number} y - Y coordinate of bottom-left corner
   * @param {number} width
   * @param {number} height
   * @param {string} style - 'stroke', 'fill', or 'both'
   */
  drawRect(x, y, width, height, style = 'stroke') {
    this.operations.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`);
    if (style === 'fill') {
      this.operations.push('f');
    } else if (style === 'both') {
      this.operations.push('B');
    } else {
      this.operations.push('S');
    }
  }

  /**
   * Draw an image
   * @param {string} imageName - The image name returned by PDFDocument.addImage()
   * @param {number} x - X coordinate of bottom-left corner
   * @param {number} y - Y coordinate of bottom-left corner
   * @param {number} width - Display width in points
   * @param {number} height - Display height in points
   */
  drawImage(imageName, x, y, width, height) {
    // Save graphics state, apply transformation matrix, draw image, restore state
    this.operations.push('q'); // Save state
    this.operations.push(`${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm`); // Transform
    this.operations.push(`/${imageName} Do`); // Draw image
    this.operations.push('Q'); // Restore state
  }

  /**
   * Set the font size
   * @param {number} size - Font size in points
   */
  setFontSize(size) {
    this.fontSize = size;
  }

  /**
   * Check if a character is in the WinAnsi encoding range (Latin-1 compatible)
   * @param {number} code - Character code
   * @returns {boolean}
   */
  isWinAnsiChar(code) {
    // Basic ASCII printable range
    if (code >= 32 && code <= 126) return true;
    // Extended Latin characters in WinAnsi (Windows-1252)
    if (code >= 160 && code <= 255) return true;
    // Some additional WinAnsi characters
    const winAnsiExtras = [
      0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
      0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178
    ];
    return winAnsiExtras.includes(code);
  }

  /**
   * Convert character to WinAnsi code for PDF
   * @param {number} code - Unicode code point
   * @returns {number} - WinAnsi code or -1 if not supported
   */
  toWinAnsiCode(code) {
    // Direct mapping for basic Latin and Latin-1 supplement
    if (code >= 32 && code <= 255) return code;

    // WinAnsi special mappings
    const mapping = {
      0x20ac : 128, // Euro
      0x201a : 130, // Single low-9 quotation
      0x0192 : 131, // Latin small f with hook
      0x201e : 132, // Double low-9 quotation
      0x2026 : 133, // Horizontal ellipsis
      0x2020 : 134, // Dagger
      0x2021 : 135, // Double dagger
      0x02c6 : 136, // Circumflex
      0x2030 : 137, // Per mille
      0x0160 : 138, // S with caron
      0x2039 : 139, // Single left angle quote
      0x0152 : 140, // OE ligature
      0x017d : 142, // Z with caron
      0x2018 : 145, // Left single quote
      0x2019 : 146, // Right single quote
      0x201c : 147, // Left double quote
      0x201d : 148, // Right double quote
      0x2022 : 149, // Bullet
      0x2013 : 150, // En dash
      0x2014 : 151, // Em dash
      0x02dc : 152, // Small tilde
      0x2122 : 153, // Trademark
      0x0161 : 154, // s with caron
      0x203a : 155, // Single right angle quote
      0x0153 : 156, // oe ligature
      0x017e : 158, // z with caron
      0x0178 : 159 // Y with diaeresis
    };

    return mapping[code] ?? -1;
  }

  /**
   * Encode text for PDF using WinAnsi encoding with octal escapes
   * @param {string} text
   * @returns {string}
   */
  encodeTextForPDF(text) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const winAnsiCode = this.toWinAnsiCode(code);

      if (winAnsiCode >= 32 && winAnsiCode <= 126) {
        // Printable ASCII - escape special chars
        const char = String.fromCharCode(winAnsiCode);
        if (char === '\\' || char === '(' || char === ')') {
          result += '\\' + char;
        } else {
          result += char;
        }
      } else if (winAnsiCode >= 0 && winAnsiCode <= 255) {
        // Use octal escape for non-printable or extended chars
        result += '\\' + winAnsiCode.toString(8).padStart(3, '0');
      } else {
        // Character not in WinAnsi - use replacement character or skip
        // Use a question mark as fallback for unsupported characters
        result += '?';
      }
    }
    return result;
  }

  /**
   * Check if text contains characters outside WinAnsi range
   * @param {string} text
   * @returns {boolean}
   */
  needsUnicodeFont(text) {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (this.toWinAnsiCode(code) === -1) {
        return true;
      }
    }
    return false;
  }

  /**
   * Convert text to glyph ID hex string for PDF
   * Uses the font's cmap to map Unicode to glyph IDs
   * @param {string} text
   * @returns {string}
   */
  textToGlyphHex(text) {
    let hex = '';
    const unicodeToGlyph = this.document.unicodeToGlyph;

    // Iterate through code points (not code units) to handle emojis correctly
    for (const char of text) {
      const codePoint = char.codePointAt(0);

      // Look up glyph ID from font's cmap
      let glyphId = 0; // 0 is typically the .notdef glyph
      if (unicodeToGlyph && unicodeToGlyph.has(codePoint)) {
        glyphId = unicodeToGlyph.get(codePoint);
      }

      hex += glyphId.toString(16).toUpperCase().padStart(4, '0');
    }
    return hex;
  }

  /**
   * Draw text at a position
   * Uses embedded Unicode font if available, otherwise falls back to WinAnsi encoding
   * @param {string} text - The text to draw
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   */
  drawText(text, x, y) {
    this.operations.push('BT'); // Begin text
    this.operations.push(`${x.toFixed(2)} ${y.toFixed(2)} Td`); // Position

    // Check if we have embedded font with parsed cmap
    if (this.document.embeddedFont && this.document.unicodeToGlyph) {
      // Use embedded Unicode font (F2) with glyph ID encoding
      this.operations.push(`/F2 ${this.fontSize} Tf`);
      const hexText = this.textToGlyphHex(text);
      this.operations.push(`<${hexText}> Tj`);
    } else {
      // Fall back to built-in Helvetica with WinAnsi encoding
      this.operations.push(`/F1 ${this.fontSize} Tf`);
      const encodedText = this.encodeTextForPDF(text);
      this.operations.push(`(${encodedText}) Tj`);
    }

    this.operations.push('ET'); // End text
  }

  /**
   * Save the current graphics state
   */
  saveState() {
    this.operations.push('q');
  }

  /**
   * Restore the previously saved graphics state
   */
  restoreState() {
    this.operations.push('Q');
  }

  /**
   * Set a clipping rectangle
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   */
  clipRect(x, y, width, height) {
    this.operations.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`);
    this.operations.push('W n'); // Set clipping path and clear path
  }

  /**
   * Get the content stream for this page
   * @returns {string}
   */
  getContentStream() {
    return this.operations.join('\n');
  }
}

/**
 * Helper function to convert mm to points
 * @param {number} mm
 * @returns {number}
 */
export function mmToPt(mm) {
  return mm * MM_TO_PT;
}

/**
 * Helper function to convert points to mm
 * @param {number} pt
 * @returns {number}
 */
export function ptToMm(pt) {
  return pt / MM_TO_PT;
}

/**
 * Create a new PDF document with specified page size in mm
 * @param {number} widthMM - Page width in mm
 * @param {number} heightMM - Page height in mm
 * @returns {PDFDocument}
 */
export function createPDF(widthMM = 210, heightMM = 297) {
  return new PDFDocument({
    width  : mmToPt(widthMM),
    height : mmToPt(heightMM)
  });
}
