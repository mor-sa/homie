import { unzipSync, strFromU8 } from "fflate";

// Minimal .xlsx reader: values only (no styles/formulas). Written because bank exports
// use namespace-prefixed XML and absolute part paths that common libraries choke on.
// Returns [{ name, grid }] where grid[row][col] is a string or number (dates stay Excel serials).

const decode = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'"
      : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

// drop element prefixes like <x:row> -> <row>
const unprefix = (xml) => xml.replace(/<(\/?)[A-Za-z0-9]+:/g, "<$1");
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function open(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  return (path) => {
    const p = path.replace(/^\//, "");
    const f = files[p];
    return f ? unprefix(strFromU8(f).replace(/^﻿/, "")) : null;
  };
}

/**
 * Reads conditional-formatting rules of the form =EQ($G3,"קטגוריה") / =$G3="קטגוריה" and returns
 * { categoryName: "#rrggbb" } from their fill colors: the colors the household already uses in Sheets.
 */
export function readCategoryColors(buffer) {
  const get = open(buffer);
  const dxfs = [...(get("xl/styles.xml") ?? "").matchAll(/<dxf>([\s\S]*?)<\/dxf>/g)].map(
    (m) => m[1].match(/<fill>[\s\S]*?<(?:bgColor|fgColor) rgb="(?:FF)?([0-9A-Fa-f]{6})"/)?.[1],
  );
  const colors = {};
  for (let i = 1; i < 50; i++) {
    const xml = get(`xl/worksheets/sheet${i}.xml`);
    if (!xml) break;
    for (const m of xml.matchAll(/<cfRule\s[^>]*dxfId="(\d+)"[^>]*>\s*<formula>([\s\S]*?)<\/formula>/g)) {
      const cat = decode(m[2]).match(/"([^"]+)"/)?.[1];
      const hex = dxfs[Number(m[1])];
      if (cat && hex && !colors[cat]) colors[cat] = "#" + hex.toLowerCase();
    }
  }
  return colors;
}

export function readXlsx(buffer) {
  const get = open(buffer);

  const shared = [];
  const ss = get("xl/sharedStrings.xml");
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const rels = {};
  for (const m of (get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\s[^>]*>/g)) {
    let target = attr(m[0], "Target");
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
    rels[attr(m[0], "Id")] = target;
  }

  const wb = get("xl/workbook.xml") ?? "";
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\s[^>]*>/g)) {
    const xml = get(rels[attr(m[0], "r:id")] ?? "");
    if (!xml) continue;
    const grid = [];
    for (const row of xml.matchAll(/<row\s[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number(attr(row[0], "r")) - 1;
      const vals = [];
      for (const c of (row[1] ?? "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = " " + c[1];
        const ref = attr(tag, "r");
        const type = attr(tag, "t");
        const body = c[2] ?? "";
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val;
        if (type === "s") val = v != null ? shared[Number(v)] : "";
        else if (type === "inlineStr") val = textOf(body);
        else if (type === "str" || type === "e") val = v != null ? decode(v) : "";
        else if (type === "b") val = v === "1";
        else val = v != null && v !== "" ? Number(v) : null;
        if (val != null && ref) vals[colIndex(ref)] = val;
      }
      grid[r] = vals;
    }
    sheets.push({ name: decode(attr(m[0], "name") ?? ""), grid });
  }
  return sheets;
}
