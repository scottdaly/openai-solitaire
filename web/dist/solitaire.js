// web/solitaire.ts
var root = document.getElementById("solitaire-root");
var state = null;
var selected = null;
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  for (const c of children) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}
function cardLabel(c) {
  const rank = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][c.rank - 1];
  return `${rank}${c.suit}`;
}
function render() {
  if (!state) return;
  root.innerHTML = "";
  const hud = h(
    "div",
    { className: "hud" },
    h("button", { onclick: newGame }, "New Game"),
    h("button", { onclick: () => call("solitaire.flip_stock", {}) }, "Flip / Recycle"),
    h("button", { onclick: () => call("solitaire.auto_move", {}) }, "Auto-move"),
    h("span", {}, `Moves: ${state.moveCount}`),
    state.won ? h("span", { className: "greenDot", title: "You win!" }) : h("span", {})
  );
  root.append(hud);
  const stockEl = h("div", { className: "stock" });
  stockEl.append(h("div", {}, "Stock"), h("div", { className: "slot" }));
  stockEl.onclick = () => call("solitaire.flip_stock", {});
  const wasteEl = h("div", { className: "waste" });
  wasteEl.append(h("div", {}, "Waste"));
  const wTop = state.stockWaste.waste[state.stockWaste.waste.length - 1];
  if (wTop) {
    const wCard = renderCard(wTop);
    wCard.onclick = () => {
      selected = { from: "waste" };
      repaintSelection();
    };
    wasteEl.append(wCard);
  }
  const fWrap = h("div", { className: "stockRow" }, stockEl, wasteEl);
  for (const s of ["\u2660", "\u2665", "\u2666", "\u2663"]) {
    const f = h("div", { className: "foundation" }, h("div", {}, `Foundation ${s}`));
    const pile = state.foundations[s];
    const top = pile[pile.length - 1];
    if (top) f.append(renderCard(top));
    fWrap.append(f);
  }
  root.append(fWrap);
  const board = h("div", { className: "board" });
  for (let col = 0; col < 7; col++) {
    const colEl = h("div", { className: "pile col" });
    const pile = state.tableau[col];
    if (!pile.length) {
      const slot = h("div", { className: "slot" });
      slot.onclick = () => handleColumnClick(col);
      colEl.append(slot);
    }
    pile.forEach((c, idx) => {
      const cardEl = renderCard(c);
      if (c.faceUp) {
        cardEl.onclick = () => {
          const count = pile.length - idx;
          selected = { from: "tableau", col, count };
          repaintSelection();
        };
      }
      colEl.append(cardEl);
    });
    colEl.onclick = (e) => {
      if (e.target.classList.contains("card")) return;
      handleColumnClick(col);
    };
    board.append(colEl);
  }
  root.append(board);
}
function repaintSelection() {
  const cards = root.querySelectorAll(".card");
  cards.forEach((c) => c.classList.remove("selected"));
  if (!selected) return;
}
function renderCard(c) {
  const el = h("div", { className: "card" + (c.faceUp ? "" : " faceDown") }, c.faceUp ? cardLabel(c) : " ");
  if (c.faceUp && (c.suit === "\u2665" || c.suit === "\u2666")) el.classList.add("red");
  return el;
}
async function call(name, args) {
  const res = await window.openai.callTool(name, args);
  if (res?._meta?.state) state = res._meta.state;
  render();
  window.openai.setWidgetState({ gameId: state?.id, moveCount: state?.moveCount });
}
async function newGame() {
  const res = await window.openai.callTool("solitaire.new_game", { draw: 1 });
  state = res._meta.state;
  render();
  window.openai.setWidgetState({ gameId: state.id, moveCount: 0 });
}
async function handleColumnClick(targetCol) {
  if (!selected) return;
  if (selected.from === "waste") {
    await call("solitaire.apply_move", { move: { type: "waste_to_tableau", to: targetCol } });
  }
  if (selected.from === "tableau" && typeof selected.col === "number" && typeof selected.count === "number") {
    await call("solitaire.apply_move", { move: { type: "tableau_to_tableau", from: selected.col, to: targetCol, count: selected.count } });
  }
  selected = null;
  repaintSelection();
}
(async function bootstrap() {
  const boot = window.openai?.toolOutput;
  const ws = window.openai?.getWidgetState?.();
  const possible = window.openai?._meta?.state;
  if (possible) {
    state = possible;
  } else {
    await newGame();
    return;
  }
  if (ws?.gameId && state?.id === ws.gameId) {
  }
  render();
})();
