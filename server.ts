import express from "express";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** ---------- Game types & helpers ---------- */
type Suit = "♠" | "♥" | "♦" | "♣";
type Rank = 1|2|3|4|5|6|7|8|9|10|11|12|13; // A..K
type Card = { id: string; suit: Suit; rank: Rank; faceUp: boolean };
type Pile = Card[];
type Foundations = { [s in Suit]: Pile };       // foundations by suit
type Tableau = Pile[];                           // 7 columns
type StockWaste = { stock: Pile; waste: Pile };
type GameState = {
  id: string;
  draw: 1 | 3;
  tableau: Tableau;
  foundations: Foundations;
  stockWaste: StockWaste;
  moveCount: number;
  won: boolean;
};

/** Utils */
const suits: Suit[] = ["♠", "♥", "♦", "♣"];
const ranks: Rank[] = [1,2,3,4,5,6,7,8,9,10,11,12,13];
const isRed = (s: Suit) => s === "♥" || s === "♦";

function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of suits) for (const r of ranks)
    deck.push({ id: `${s}${r}-${Math.random().toString(36).slice(2,8)}`, suit: s, rank: r, faceUp: false });
  // shuffle
  for (let i = deck.length-1; i>0; i--) { const j = Math.floor(Math.random()*(i+1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}

function deal(draw: 1|3 = 1): GameState {
  const deck = makeDeck();
  const tableau: Tableau = [[],[],[],[],[],[],[]];
  for (let col=0; col<7; col++) {
    for (let n=0; n<=col; n++) {
      const c = deck.pop()!;
      c.faceUp = n===col;
      tableau[col].push(c);
    }
  }
  const stockWaste: StockWaste = { stock: deck, waste: [] };
  const foundations: Foundations = { "♠":[], "♥":[], "♦":[], "♣":[] };
  return { id: Math.random().toString(36).slice(2), draw, tableau, foundations, stockWaste, moveCount: 0, won: false };
}

function canStackOnTableau(a: Card, b: Card | undefined): boolean {
  // place card 'a' onto top card 'b' of target pile
  if (!b) return a.rank === 13; // empty column must take a King
  return isRed(a.suit) !== isRed(b.suit) && a.rank === b.rank - 1;
}

function canMoveToFoundation(a: Card, foundation: Pile): boolean {
  const top = foundation[foundation.length-1];
  if (!top) return a.rank === 1; // Ace starts
  return a.suit === top.suit && a.rank === top.rank + 1;
}

function top(pile: Pile) { return pile[pile.length-1]; }

function checkWin(state: GameState): boolean {
  return suits.every(s => state.foundations[s].length === 13);
}

/** apply a move, returning new state if legal, else original */
type Move =
 | { type: "flip_stock" }
 | { type: "recycle_stock" }
 | { type: "tableau_to_tableau", from: number, count: number, to: number }
 | { type: "tableau_to_foundation", from: number }
 | { type: "waste_to_tableau", to: number }
 | { type: "waste_to_foundation" };

function clone<T>(x: T): T { return structuredClone(x); }

function applyMove(state: GameState, move: Move): GameState {
  const s = clone(state);
  const { tableau, foundations, stockWaste } = s;
  const { stock, waste } = stockWaste;

  const flipFaceDownTop = (col: number) => {
    const pile = tableau[col];
    if (pile.length && !pile[pile.length-1].faceUp) pile[pile.length-1].faceUp = true;
  };

  switch (move.type) {
    case "flip_stock": {
      for (let i=0; i<s.draw; i++) {
        if (!stock.length) break;
        const c = stock.pop()!;
        c.faceUp = true;
        waste.push(c);
      }
      s.moveCount++;
      break;
    }
    case "recycle_stock": {
      if (stock.length) return state;
      while (waste.length) {
        const c = waste.pop()!; c.faceUp = false; stock.push(c);
      }
      s.moveCount++;
      break;
    }
    case "tableau_to_tableau": {
      const {from, count, to} = move;
      const src = tableau[from];
      if (!src.length) return state;
      const startIdx = src.findIndex(c => c.faceUp);
      if (startIdx < 0) return state;
      const moving = src.slice(src.length - count);
      if (moving.length !== count || !moving.every(c => c.faceUp)) return state;
      // validate descending alt colors within moving
      for (let i=0; i<moving.length-1; i++) {
        if (!(isRed(moving[i].suit) !== isRed(moving[i+1].suit) && moving[i].rank === moving[i+1].rank + 1)) {
          return state;
        }
      }
      const tgtTop = top(tableau[to]);
      if (!canStackOnTableau(moving[0], tgtTop)) return state;
      tableau[from] = src.slice(0, src.length - count);
      tableau[to].push(...moving);
      if (tableau[from].length && !tableau[from][tableau[from].length-1].faceUp) {
        tableau[from][tableau[from].length-1].faceUp = true;
      }
      s.moveCount++;
      break;
    }
    case "tableau_to_foundation": {
      const {from} = move;
      const src = tableau[from];
      const card = top(src);
      if (!card || !card.faceUp) return state;
      const f = foundations[card.suit];
      if (!canMoveToFoundation(card, f)) return state;
      src.pop();
      f.push(card);
      if (src.length && !top(src)!.faceUp) top(src)!.faceUp = true;
      s.moveCount++;
      break;
    }
    case "waste_to_tableau": {
      const card = top(waste); if (!card) return state;
      const tgtTop = top(tableau[move.to]);
      if (!canStackOnTableau(card, tgtTop)) return state;
      waste.pop(); tableau[move.to].push(card);
      s.moveCount++;
      break;
    }
    case "waste_to_foundation": {
      const card = top(waste); if (!card) return state;
      const f = foundations[card.suit];
      if (!canMoveToFoundation(card, f)) return state;
      waste.pop(); f.push(card);
      s.moveCount++;
      break;
    }
  }
  s.won = checkWin(s);
  return s;
}

/** Simple auto-move: try pushing any eligible top cards to foundation */
function autoMove(state: GameState): GameState {
  let changed = true;
  let cur = clone(state);
  while (changed) {
    changed = false;
    // waste
    const w = top(cur.stockWaste.waste);
    if (w && canMoveToFoundation(w, cur.foundations[w.suit])) {
      cur = applyMove(cur, { type: "waste_to_foundation" });
      changed = true; continue;
    }
    // tableau
    for (let i=0; i<7; i++) {
      const c = top(cur.tableau[i]);
      if (c && c.faceUp && canMoveToFoundation(c, cur.foundations[c.suit])) {
        cur = applyMove(cur, { type: "tableau_to_foundation", from: i });
        changed = true; break;
      }
    }
  }
  return cur;
}

/** ---------- MCP server ---------- */
const server = new McpServer({ name: "solitaire-server", version: "0.1.0" });

// Inline widget bundle (built by esbuild)
const SOLITAIRE_JS = readFileSync("web/dist/solitaire.js", "utf8");

server.registerResource(
  "solitaire-widget",
  "ui://widget/solitaire.html",
  {},
  async () => ({
    contents: [
      {
        uri: "ui://widget/solitaire.html",
        mimeType: "text/html+skybridge",
        text: `
<div id="solitaire-root"></div>
<style>
  :root { --card: #fff; --ink:#222; --green:#0b7; --bg:#0f1214; }
  body{margin:0;background:var(--bg);color:#eee;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Inter,sans-serif}
  .hud{display:flex;gap:.75rem;align-items:center;padding:10px 12px;background:#0a0d0f;border-bottom:1px solid #1c2328;position:sticky;top:0;z-index:2}
  button{padding:6px 10px;border-radius:10px;border:1px solid #2a343a;background:#161c20;color:#e8f6f0;cursor:pointer}
  button:hover{background:#1a2328}
  .board{padding:12px;display:grid;grid-template-columns:repeat(7, minmax(110px, 1fr));gap:12px}
  .stockRow{display:flex;gap:12px;padding:12px;border-bottom:1px dashed #1c2328}
  .pile, .foundation, .waste, .stock{min-height:160px;border-radius:12px;border:1px dashed #274047;background:rgba(255,255,255,0.02);position:relative;padding:8px}
  .card{width:90px;height:128px;border-radius:10px;background:var(--card);color:var(--ink);display:flex;align-items:center;justify-content:center;
        font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.3);position:relative}
  .card.faceDown{background:linear-gradient(45deg,#0b7,#074);color:transparent}
  .slot{height:24px}
  .col{display:flex;flex-direction:column;gap:10px}
  .red{color:#c43}
  .greenDot{position:absolute;top:8px;right:8px;width:10px;height:10px;background:var(--green);border-radius:999px}
</style>
<script type="module">${SOLITAIRE_JS}</script>
        `.trim(),
        _meta: {
          // Lock down external resources if you later add any hosted assets.
          "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
          "openai/widgetDescription": "An interactive Klondike Solitaire board with draw-1 or draw-3, legal moves, and auto-move.",
        },
      },
    ],
  })
);

// Memory-less ephemeral store—fine for demo; swap to real storage if needed.
let CURRENT: GameState | null = null;

server.registerTool(
  "solitaire.new_game",
  {
    title: "Deal a new Solitaire game",
    description: "Starts a new Klondike Solitaire game.",
    _meta: {
      "openai/outputTemplate": "ui://widget/solitaire.html",
      "openai/toolInvocation/invoking": "Dealing a fresh game…",
      "openai/toolInvocation/invoked": "Dealt a new game.",
      "openai/widgetAccessible": true // allow in-widget calls
    },
    inputSchema: { draw: z.number().optional() } // 1 or 3
  },
  async ({ draw = 1 }) => {
    CURRENT = deal(draw === 3 ? 3 : 1);
    return {
      // Keep payload tidy for the model; full state goes to _meta
      structuredContent: {
        moveCount: CURRENT.moveCount,
        won: CURRENT.won
      },
      content: [{ type: "text", text: "New Klondike deal ready. Good luck!" }],
      _meta: { state: CURRENT } // component reads full state here (not shown to model)
    };
  }
);

server.registerTool(
  "solitaire.apply_move",
  {
    title: "Apply a Solitaire move",
    description: "Validates and applies a legal move to the current Solitaire state.",
    _meta: {
      "openai/outputTemplate": "ui://widget/solitaire.html",
      "openai/widgetAccessible": true
    },
    inputSchema: {
      move: z.object({
        type: z.enum(["flip_stock","recycle_stock","tableau_to_tableau","tableau_to_foundation","waste_to_tableau","waste_to_foundation"]),
        from: z.number().optional(),
        to: z.number().optional(),
        count: z.number().optional()
      })
    }
  },
  async ({ move }) => {
    if (!CURRENT) CURRENT = deal(1);
    CURRENT = applyMove(CURRENT, move);
    return {
      structuredContent: { moveCount: CURRENT.moveCount, won: CURRENT.won },
      _meta: { state: CURRENT },
      content: CURRENT.won ? [{ type: "text", text: "You win! 🎉" }] : []
    };
  }
);

server.registerTool(
  "solitaire.flip_stock",
  {
    title: "Flip stock",
    description: "Flip from stock to waste (or recycle when empty).",
    _meta: {
      "openai/outputTemplate": "ui://widget/solitaire.html",
      "openai/widgetAccessible": true
    },
    inputSchema: {}
  },
  async () => {
    if (!CURRENT) CURRENT = deal(1);
    // flip or recycle
    if (CURRENT.stockWaste.stock.length) {
      CURRENT = applyMove(CURRENT, { type: "flip_stock" });
    } else {
      CURRENT = applyMove(CURRENT, { type: "recycle_stock" });
    }
    return { structuredContent: { moveCount: CURRENT.moveCount, won: CURRENT.won }, _meta: { state: CURRENT } };
  }
);

server.registerTool(
  "solitaire.auto_move",
  {
    title: "Auto-move obvious cards",
    description: "Move any obvious cards to foundations.",
    _meta: {
      "openai/outputTemplate": "ui://widget/solitaire.html",
      "openai/widgetAccessible": true
    },
    inputSchema: {}
  },
  async () => {
    if (!CURRENT) CURRENT = deal(1);
    CURRENT = autoMove(CURRENT);
    return { structuredContent: { moveCount: CURRENT.moveCount, won: CURRENT.won }, _meta: { state: CURRENT } };
  }
);

/** ---------- HTTP host + /mcp endpoint ---------- */
const app = express();
app.use(express.json());

// Minimal MCP over HTTP handler
app.post("/mcp", async (req, res) => {
  try {
    const result = await server.handleRequest(req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`Solitaire MCP server on http://localhost:${PORT}/mcp`));
