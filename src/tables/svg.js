'use strict';

var parse = require('../parse');
var table = require('../table');
var types = require('../types');
var pako = require('pako');
var decode = types.decode;
var encode = types.encode;

function parseSvgDocumentIndexEntry(p) {
    return {
        startGlyphID: p.parseUShort(),
        // Must be >= startGlyphID.
        // FIXME: test this here?
        // it would be nice in some cases to get informed of a malformed table
        // but maybe not in all cases, e.g. if I want to inspect the broken table
        endGlyphID: p.parseUShort(),
        svgDocOffset: p.parseULong(),
        svgDocLength: p.parseULong()
    };
}

function isGzipped(dataView) {
    return dataView.getUint8(0) === 0x1F && dataView.getUint8(1) === 0x8B;
}

function parseSvgDocument(data, docIndexStart, svgDocumentIndexEntry) {
    var svgDataView = new DataView(
            data.buffer,
            data.byteOffset + docIndexStart + svgDocumentIndexEntry.svgDocOffset,
            svgDocumentIndexEntry.svgDocLength
        ),
        compressed = isGzipped(svgDataView)
    ;
    // the SVG documents be either plain-text or gzip-encoded [RFC1952].
    if(compressed) {
        // pako takes an Uint8Array
        svgDataView = new Uint8Array(svgDataView.buffer,
                                     svgDataView.byteOffset,
                                     svgDataView.byteLength);
        svgDataView = new DataView(pako.ungzip(svgDataView).buffer);
    }

    return {
        // The encoding of the (uncompressed) SVG document must be UTF-8.
        data: decode.UTF8(svgDataView, 0, svgDataView.byteLength),
        compressed: compressed,
        startGlyphID: svgDocumentIndexEntry.startGlyphID,
        endGlyphID: svgDocumentIndexEntry.endGlyphID
    };
}

function parseSvgTable(data, start) {
    var svg = {},
        p = new parse.Parser(data, start),
        i, l, docIndexStart, svgDocumentIndexEntry, svgDoc
      ;

    // SVG Main Header
    svg.version = p.parseUShort();
    svg.offsetToSVGDocIndex = p.parseULong();
    svg.reserved = p.parseULong();

    // SVG Document Index
    svg.numEntries = p.parseUShort();
    docIndexStart = start + svg.offsetToSVGDocIndex;

    svg.svgDocuments = [];
    for(i=0,l=svg.numEntries;i<l;i++) {
        svgDocumentIndexEntry = parseSvgDocumentIndexEntry(p);
        svgDoc = parseSvgDocument(data, docIndexStart, svgDocumentIndexEntry);
        svg.svgDocuments.push(svgDoc);
    }

    return svg;
}

function makeSvgTable (svg) {
    var data, i, l, svgDocument, svgDocuments,
        svgDocOffset, svgData,
        svgDocumentIndexEntrySize = 2 + 2 + 4 + 4
      ;

    data = [
        // SVG Main Header
        {name: 'version', type: 'USHORT', value: 0},
        {name: 'offsetToSVGDocIndex', type: 'ULONG', value: svg.offsetToSVGDocIndex},
        // spec says it should be 0, but I want it to be flexible for roundtripping existing fonts
        {name: 'reserved',  type: 'ULONG', value: 0},
        // SVG Document Index
        {name: 'numEntries', type: 'USHORT', value: svg.svgDocuments.length}
    ];

    // Offset from the beginning of the *SVG Document Index* to an SVG document.
    // This is the offset to the first SVG Document.
     // 2 == byte length of ushort numEntries
    svgDocOffset = 2 + svg.svgDocuments.length * svgDocumentIndexEntrySize;

    svgDocuments = [];
    for(i=0,l=svg.svgDocuments.length;i<l;i++) {
        svgDocument = svg.svgDocuments[i];
        // The encoding of the (uncompressed) SVG document must be UTF-8.
        svgData = encode.UTF8(svgDocument.data);
        if(svgDocument.compressed) {
            svgData = pako.gzip(svgData);
            //convert Uint8Array to regular Array
            svgData = Array.prototype.slice.call(svgData);
        }
        svgDocuments.push(svgData);
    }

    for(i=0,l=svg.svgDocuments.length;i<l;i++) {
        svgDocument = svg.svgDocuments[i];

        data.push(
            {name: 'startGlyphID_' + i, type: 'USHORT', value: svgDocument.startGlyphID},
            {name: 'endGlyphID_' + i, type: 'USHORT', value: svgDocument.endGlyphID},
            {name: 'svgDocOffset_' + i,  type: 'ULONG', value: svgDocOffset},
            {name: 'svgDocLength_' + i,  type: 'ULONG', value: svgDocuments[i].length}
        );
        svgDocOffset += svgDocuments[i].length;
    }

    for (i=0,l=svgDocuments.length;i<l;i++)
        data.push({name: 'svgDocument_' + i, type: 'LITERAL', value: svgDocuments[i]});

    return new table.Table('SVG ', data, {}/*options*/);
}

exports.parse = parseSvgTable;
exports.make = makeSvgTable;
