// Runs inside ChatGPT's iframe.
// Available global API: window.openai.* (Apps SDK Reference).
type AnyState = any;
declare global {
  interface Window {
    openai: {
      toolOutput?: { moveCount: number; won: boolean };
      setWidgetState: (state: any) => void;
      getWidgetState: () => any;
      callTool: (name: string, args: any) => Promise<{ structuredContent?: any; _meta?: any; content?: any }>;
    };
  }
}

type GameState = {
  id: string;
  draw: 1|3;
  tableau: { id?:string; suit:string; rank:number; faceUp:boolean }[][];
  foundations: Record<string, any[]>;
  stockWaste: { stock: any[]; waste: any[] };
  moveCount: number;
  won: boolean;
};

const root = document.getElementById("solitaire-root")!;
let state: GameState | null = null;
let selected: { from: "waste" | "tableau"; col?: number; count?: number } | null = null;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: any={}, ...children: (Node|string)[]) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

function cardLabel(c: any) {
  const rank = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"][c.rank-1];
  return `${rank}${c.suit}`;
}

function render() {
  if (!state) return;
  root.innerHTML = "";

  // HUD
  const hud = h("div", { className: "hud" },
    h("button", { onclick: newGame }, "New Game"),
    h("button", { onclick: () => call("solitaire.flip_stock", {}) }, "Flip / Recycle"),
    h("button", { onclick: () => call("solitaire.auto_move", {}) }, "Auto-move"),
    h("span", {}, `Moves: ${state.moveCount}`),
    state.won ? h("span", { className:"greenDot", title:"You win!" }) : h("span", {})
  );
  root.append(hud);

  // Stock / Waste / Foundations row
  const stockEl = h("div", { className: "stock" });
  stockEl.append(h("div", {}, "Stock"), h("div", { className:"slot" }));
  stockEl.onclick = () => call("solitaire.flip_stock", {});

  const wasteEl = h("div", { className: "waste" });
  wasteEl.append(h("div", {}, "Waste"));
  const wTop = state.stockWaste.waste[state.stockWaste.waste.length-1];
  if (wTop) {
    const wCard = renderCard(wTop);
    wCard.onclick = () => { selected = { from:"waste" }; repaintSelection(); };
    wasteEl.append(wCard);
  }

  const fWrap = h("div", { className: "stockRow" }, stockEl, wasteEl);
  for (const s of ["♠","♥","♦","♣"]) {
    const f = h("div", { className: "foundation" }, h("div", {}, `Foundation ${s}`));
    const pile = state.foundations[s];
    const top = pile[pile.length-1];
    if (top) f.append(renderCard(top));
    fWrap.append(f);
  }
  root.append(fWrap);

  // Tableau grid
  const board = h("div", { className: "board" });
  for (let col=0; col<7; col++) {
    const colEl = h("div", { className: "pile col" });
    const pile = state.tableau[col];
    if (!pile.length) {
      const slot = h("div", { className:"slot" });
      slot.onclick = () => handleColumnClick(col);
      colEl.append(slot);
    }
    pile.forEach((c, idx) => {
      const cardEl = renderCard(c);
      if (c.faceUp) {
        cardEl.onclick = () => {
          // Select a run from this card to top
          const count = pile.length - idx;
          selected = { from:"tableau", col, count };
          repaintSelection();
        };
      }
      colEl.append(cardEl);
    });
    // Drop target: clicking empty space to attempt a move
    colEl.onclick = (e) => {
      if ((e.target as HTMLElement).classList.contains("card")) return; // handled
      handleColumnClick(col);
    };
    board.append(colEl);
  }
  root.append(board);
}

function repaintSelection() {
  // Visual hint: border highlight
  const cards = root.querySelectorAll(".card");
  cards.forEach(c => c.classList.remove("selected"));
  if (!selected) return;
}

function renderCard(c: any) {
  const el = h("div", { className: "card" + (c.faceUp ? "" : " faceDown") }, c.faceUp ? cardLabel(c) : " ");
  if (c.faceUp && (c.suit === "♥" || c.suit === "♦")) el.classList.add("red");
  return el;
}

async function call(name: string, args: any) {
  const res = await window.openai.callTool(name, args);
  // Preferred pattern: hydrate full state from _meta; keep model payload small
  if (res?._meta?.state) state = res._meta.state as GameState;
  render();
  window.openai.setWidgetState({ gameId: state?.id, moveCount: state?.moveCount });
}

async function newGame() {
  const res = await window.openai.callTool("solitaire.new_game", { draw: 1 });
  state = res._meta.state as GameState;
  render();
  window.openai.setWidgetState({ gameId: state.id, moveCount: 0 });
}

async function handleColumnClick(targetCol: number) {
  if (!selected) return;
  // waste → tableau
  if (selected.from === "waste") {
    await call("solitaire.apply_move", { move: { type:"waste_to_tableau", to: targetCol }});
  }
  // tableau → tableau
  if (selected.from === "tableau" && typeof selected.col === "number" && typeof selected.count === "number") {
    await call("solitaire.apply_move", { move: { type:"tableau_to_tableau", from: selected.col, to: targetCol, count: selected.count }});
  }
  selected = null;
  repaintSelection();
}

(async function bootstrap() {
  // If toolOutput/_meta already present (e.g., called via model), read it
  const boot = (window as any).openai?.toolOutput as { moveCount:number; won:boolean } | undefined;
  const ws = (window as any).openai?.getWidgetState?.() as AnyState | undefined;

  // If the server already provided state, prefer it
  const possible = (window as any).openai?._meta?.state;
  if (possible) {
    state = possible;
  } else {
    // Otherwise ask server for a new game
    await newGame();
    return;
  }
  // carry forward widget state if present
  if (ws?.gameId && state?.id === ws.gameId) {
    // nothing special; example shows how you might restore scrollers, etc.
  }
  render();
})();
