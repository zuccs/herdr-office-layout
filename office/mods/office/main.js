import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, spaces, panes, props, run, setAgentOrder, knownAgents } from "herdr";
import { ink, WALL, SLOT_W, SLOT_H, SCREEN, CATS, r, icon, txt, rng, pick, look, deskLook, clutter, seated, standing, cat, room } from "./art.js";

// A pixel-art office: every agent is a little worker at a desk. Idle workers wander,
// and everyone (the cat too) keeps to the walkways: the corridor along the wall, the aisle
// behind each row of desks, and the lanes past both ends of the rows.
const wood = "#8a5530";
const DEMO = [["working", "fix login"], ["blocked", "migrate db"], ["done", "write tests"], ["idle", "docs"], ["working", "refactor api"], ["idle", "triage"], ["idle", "lunch"], ["done", "ship it"], ["working", "perf pass"], ["idle", "standup"], ["blocked", "deploy"], ["idle", "coffee"]]
  .map(([status, tab_name], i) => ({ address: `demo${i}`, status, tab_name, space_name: "demo", title: "", program: null, focused: i === 0 }));
const THOUGHTS = ["?", "!", "♪", "♥", "...", "☼", "$", "#"];
const SPOTS = ["cooler", "cooler", "shelfL", "shelfR", "window", "door", "plant", "floor", "floor", "chat", "chat"];
const WALK = 0.11, CAT_WALK = 0.07; // px per ms
const busy = (a) => a.status === "working" || a.status === "blocked";

// Two rows of desks (more only when two would get too small), sized to fit: scale k ≤ 1.
function fit(n, w, h) {
  let best;
  for (let rows = 2; rows <= 6; rows++) {
    const cols = Math.max(3, Math.ceil(n / rows));
    const k = Math.min(1, (w - 200) / (cols * SLOT_W), (h - WALL) / (rows * SLOT_H + 40));
    if (!best || k > best.k + 0.08) best = { k: Math.max(0.35, k), cols, rows };
  }
  return best;
}

export default class Office extends View {
  init(_p, cx) {
    this.size = { width: 1200, height: 420 };
    this.seed = Math.floor(Math.random() * 2 ** 31);
    this.trips = {};     // address → { phase: enter|going|there|back, path, i, until, spot, hurry }
    this.thoughts = {};  // address → { sym, until }
    this.seats = {};     // address → { x, y, row }
    this.geo = null;
    this.known = null;
    this.door = 0;
    this.hover = null;
    this.minute = -1;
    this.n = 0;
    this.cat = { coat: pick(rng(this.seed), CATS), path: null, i: 0, until: 0, left: false };
    this.list = [];
    if (!props()?.role) cx.timer.every(250, (cx) => { if (this.tick()) cx.notify(); });
  }

  // ---- walkways -------------------------------------------------------------
  // A place is { r, x }: r = -1 is the corridor along the wall, r ≥ 0 the aisle behind desk row r.
  // A seat adds { seat: y }: one step up from its row's aisle.

  laneY(row) { const g = this.geo; return row < 0 ? g.topY : g.top + row * g.sh + Math.round(128 * g.k); }

  path(from, to, speed = WALK) {
    const g = this.geo, pts = [];
    const add = (x, y, row) => pts.push({ x: Math.round(x), y: Math.round(y), r: row });
    if (from.seat != null) add(from.x, this.laneY(from.r), from.r);
    if (from.r !== to.r) {
      const side = [g.leftX, g.rightX].sort((a, b) => Math.abs(from.x - a) + Math.abs(to.x - a) - Math.abs(from.x - b) - Math.abs(to.x - b))[0];
      add(side, this.laneY(from.r), from.r);
      add(side, this.laneY(to.r), to.r);
    }
    add(to.x, this.laneY(to.r), to.r);
    if (to.seat != null) add(to.x, to.seat, to.r);
    let prev = { x: from.x, y: from.seat ?? this.laneY(from.r) };
    for (const p of pts) {
      p.ms = Math.max(16, Math.round(Math.hypot(p.x - prev.x, p.y - prev.y) / speed));
      p.facing = p.y > prev.y ? "front" : p.y < prev.y ? "back" : "front";
      p.left = p.x < prev.x;
      prev = p;
    }
    return pts;
  }

  seatPlace(addr) { const s = this.seats[addr]; return s && { r: s.row, x: s.x, seat: s.y }; }

  spotPlace(sp) {
    const { width: w } = this.size, g = this.geo, mid = Math.round(w / 2);
    const wall = { cooler: w - 150, shelfL: mid - 250, shelfR: mid + 200, window: w - 320, door: mid - 24 }[sp.key];
    if (wall != null) return { r: -1, x: Math.round(wall + sp.jx) };
    if (sp.key === "chat" && this.seats[sp.other]) { const o = this.seats[sp.other]; return { r: o.row, x: o.x + Math.round(30 * g.k) }; }
    if (sp.key === "plant") return { r: g.rows - 1, x: Math.max(g.rightX, w - 150) };
    return { r: Math.floor(sp.fy * (g.rows + 1)) - 1, x: Math.round(8 + sp.fx * (w - 70)) };
  }

  // Four times a second: walkers turn corners. About once a second: who gets up, thoughts, the cat.
  tick() {
    if (!this.geo) return false;
    const now = Date.now(), slow = this.n++ % 4 === 0;
    let changed = false;
    const minute = new Date().getMinutes();
    if (minute !== this.minute) { this.minute = minute; changed = true; }
    for (const a of this.list) {
      const t = this.trips[a.address];
      if (t) {
        if (busy(a) && t.phase === "there") this.headBack(a, t, t.path[t.i], now), changed = true;
        else if (busy(a) && t.phase === "going") t.hurry = true;
        if (now < t.until) continue;
        changed = true;
        if (t.i < t.path.length - 1 && !(t.hurry && t.phase === "going")) { t.i++; t.until = now + t.path[t.i].ms; continue; }
        const at = t.path[t.i];
        if (t.phase === "going" && !t.hurry) Object.assign(t, { phase: "there", until: now + 3000 + Math.random() * 8000 });
        else if (t.phase === "back") delete this.trips[a.address];
        else this.headBack(a, t, at, now);
      } else if (slow && !busy(a) && Math.random() < (a.status === "done" ? 0.015 : 0.035) * (this.demo ? 4 : 1)) {
        const others = this.list.filter((o) => o.address !== a.address && !this.trips[o.address]);
        let key = SPOTS[Math.floor(Math.random() * SPOTS.length)];
        if (key === "chat" && !others.length) key = "floor";
        const spot = { key, other: key === "chat" ? others[Math.floor(Math.random() * others.length)].address : null,
          jx: Math.random() * 30 - 15, fx: Math.random(), fy: Math.random() };
        const path = this.path(this.seatPlace(a.address), this.spotPlace(spot));
        this.trips[a.address] = { phase: "going", spot, path, i: 0, until: now + path[0].ms };
        changed = true;
      } else if (slow && !this.thoughts[a.address] && Math.random() < (busy(a) ? 0.006 : 0.025)) {
        this.thoughts[a.address] = { sym: THOUGHTS[Math.floor(Math.random() * THOUGHTS.length)], until: now + 2500 + Math.random() * 3000 };
        changed = true;
      }
    }
    for (const [k, t] of Object.entries(this.thoughts)) if (now >= t.until) { delete this.thoughts[k]; changed = true; }
    changed = this.moveCat(now) || changed;
    if (this.door && now >= this.door) { this.door = 0; changed = true; }
    return changed;
  }

  headBack(a, t, at, now) {
    const path = this.path({ r: at.r, x: at.x }, this.seatPlace(a.address));
    Object.assign(t, { phase: "back", path, i: 0, until: now + path[0].ms, hurry: false });
  }

  moveCat(now) {
    const c = this.cat, g = this.geo;
    if (now < c.until) return false;
    if (c.path && c.i < c.path.length - 1) { c.i++; c.until = now + c.path[c.i].ms; c.left = c.path[c.i].left; return true; }
    const at = c.path?.[c.i] ?? { r: -1, x: Math.round(this.size.width / 3) };
    if (c.path && !c.resting) { c.resting = true; c.until = now + (Math.random() < 0.4 ? 8000 + Math.random() * 15000 : 1000 + Math.random() * 3000); return false; }
    const to = { r: Math.floor(Math.random() * (g.rows + 1)) - 1, x: Math.round(8 + Math.random() * (this.size.width - 60)) };
    c.path = this.path({ r: at.r, x: at.x }, to, CAT_WALK);
    Object.assign(c, { i: 0, until: now + c.path[0].ms, left: c.path[0].left, resting: false });
    return true;
  }

  // ---- drawing --------------------------------------------------------------

  desk(a, i, x, y, k, night) {
    const q = (v) => Math.round(v * k), R2 = (x, y, w, h, c) => r(q(x), q(y), q(w), q(h), c);
    const dl = deskLook(i, this.seed), status = a?.status;
    const lit = a && (a.focused || night);
    const el = div().absolute().left(x).top(y).w(q(SLOT_W)).h(q(130))
      .child(R2(52, 0, 66, 44, "#2b2f3a").child(a ? this.screen(a, k) : R2(6, 5, 54, 34, "#1c2028")))
      .child(R2(80, 44, 10, 6, "#2b2f3a")).child(R2(70, 50, 30, 3, "#2b2f3a"))
      .child(R2(24, 52, 122, 12, "#f0dcb0")).child(R2(24, 64, 122, 20, "#d4b27c")).child(R2(24, 64, 122, 3, "#b48a52"))
      .child(R2(28, 84, 8, 18, "#b48a52")).child(R2(134, 84, 8, 18, "#b48a52"))
      .child(R2(66, 54, 38, 6, "#e7e9ee")).child(R2(110, 44, 9, 10, dl.mug))
      // lamp
      .child(R2(30, 50, 14, 3, "#3a3a3a")).child(R2(35, 32, 3, 18, "#3a3a3a")).child(R2(28, 26, 18, 8, dl.lamp))
      .when(lit, (e) => e.child(R2(26, 34, 22, 18, "#ffe9a055")).child(R2(31, 34, 12, 3, "#fff3b0")))
      .children(clutter(dl.clutter, R2))
      .child(R2(150, 58, 16, 40, dl.tower ? "#d9dce3" : "#3a3f4a").child(R2(3, 6, 8, 2, "#555")).child(R2(5, 26, 4, 4, status === "working" ? "#5ee08a" : "#777")));
    if (status === "working") el.child(txt("~", Math.max(8, q(12)), "#ffffff99").absolute().left(q(110)).top(q(30)).id(`steam-${i}`).frames(["", "~", "≈", "~"], 450));
    if (!a) {
      el.child(R2(70, 78, 30, 26, "#3d4454")).child(R2(83, 104, 4, 8, "#2b2f3a")).child(R2(72, 112, 26, 4, "#2b2f3a"));
      if (this.demo) return el;
      return el.id(`empty-${i}`).cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => cx.spawn(async () => {
          const ag = (await knownAgents()).find((x) => x.installed);
          run("tab.new", ag ? { argv: ag.run } : {});
        }));
    }
    return el.id(`desk-${a.address}`).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => !this.demo && run("agent.focus", { terminal: a.address }))
      .on_hover((hov, cx) => { this.hover = hov ? a.address : this.hover === a.address ? null : this.hover; cx.notify(); });
  }

  label(a, x, y, k) {
    const q = (v) => Math.round(v * k);
    return h_flex().absolute().left(x).top(y + q(130)).w(q(SLOT_W)).justify_center().gap(q(6)).items_center()
      .child(icon(a.program, q(14))).child(txt(a.tab_name.slice(0, 16), Math.max(8, q(12)), a.focused ? "#fff8e1" : ink));
  }

  screen(a, k) {
    const q = (v) => Math.round(v * k);
    const s = r(q(6), q(5), q(54), q(34), SCREEN[a.status] ?? SCREEN.idle);
    if (a.status === "working")
      return s.children([0, 1, 2, 3].map((i) => r(q(5), q(5 + i * 7), q(10), Math.max(1, q(3)), "#7ee0a0")
        .id(`code-${a.address}-${i}`).loop("width", { from: q(6), to: q(40 - i * 6), period: 600 + ((i * 337) % 700) + (a.address.length * 53) % 300 })));
    if (a.status === "blocked")
      return s.flex().items_center().justify_center().child(txt("!", Math.max(8, q(16)), "#ffe9a0").id(`bang-${a.address}`).loop("opacity", { from: 0.2, to: 1, period: 600 }));
    if (a.status === "done") return s.flex().items_center().justify_center().child(txt("OK", Math.max(8, q(16)), "#bfe0ff"));
    return s.child(r(q(6), q(22), q(8), Math.max(1, q(3)), "#b8c4d0").id(`cur-${a.address}`).loop("opacity", { from: 0, to: 1, period: 1100 }));
  }

  // The worker, at their seat or out walking. Each leg of a walk animates natively.
  worker(a, k, s) {
    const lk = look(a), t = this.trips[a.address], id = `w-${a.address}`, seat = this.seats[a.address];
    let pos = seat, ms = 16, body;
    if (!t) {
      body = seated(lk, s, a.status === "done").id(`${id}-sit`);
      if (a.status === "working") body.loop("top", { from: 0, to: -Math.max(1, Math.round(s * 0.7)), period: lk.bob });
      if (a.status === "blocked") body.loop("top", { from: 0, to: -4 * s, period: 700 });
    } else {
      const p = t.path[t.i], there = t.phase === "there", enter = t.phase === "enter";
      pos = p;
      ms = enter ? 16 : p.ms;
      const wall = t.spot.key in { cooler: 1, shelfL: 1, shelfR: 1, window: 1, door: 1 };
      const facing = enter ? "front" : there ? (wall ? "back" : "front") : p.facing;
      const item = there && t.spot.key === "cooler" ? "cup" : there && t.spot.key.startsWith("shelf") ? "book" : null;
      body = standing(lk, s, facing, !there && !enter, item, id);
    }
    const th = this.thoughts[a.address];
    const chatting = t?.phase === "there" && t.spot.key === "chat";
    return div().id(id).absolute().left(pos.x).top(pos.y).w(16 * s).h(20 * s)
      .transition("left", { duration: ms, easing: "linear" }).transition("top", { duration: ms, easing: "linear" })
      .cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => !this.demo && run("agent.focus", { terminal: a.address }))
      .child(body)
      .when(!t && a.status === "done", (e) => e.child(txt("z", 16, "#24406e").absolute().left(14 * s).top(-2 * s).id(`${id}-z`).frames(["z", "zZ", "zZz", ""], 500)))
      .when(chatting, (e) => e.child(bubble(txt(".", 12, ink).id(`${id}-chat`).frames([".", "..", "..."], 400)).left(10 * s).top(-6 * s)))
      .when(!!th && !chatting, (e) => e.child(bubble(txt(th.sym, 12, ink)).left(11 * s).top(-6 * s)));
  }

  render() {
    const p = props() ?? {};
    this.demo = !!p.demo;
    if (p.role === "pane") {
      const pane = panes().find((x) => x.pane === p.pane);
      const st = pane?.status;
      return h_flex().size_full().px(10).gap(8).items_center().bg("#c99a62")
        .child(icon(pane?.program)).child(txt(pane?.program?.name ?? "Terminal", 12, ink))
        .child(div().flex_1())
        .child(txt(st === "blocked" ? "NEEDS YOU" : (st ?? "").toUpperCase(), 12, st === "blocked" ? "#a8322a" : ink));
    }
    if (p.role === "rail") {
      const s = spaces().find((s) => s.active), tab = s?.tabs.find((t) => t.active);
      return h_flex().size_full().bg(wood).px(16).items_center()
        .child(txt(`${s?.name ?? ""} / ${tab?.name ?? ""}`, 12, "#fff1d6"));
    }
    // props.demo fills the desks with sample workers in every state (for previews).
    const list = p.demo ? DEMO : agents();
    if (!p.demo) setAgentOrder(list.map((a) => a.address));
    this.list = list;

    const { width: w, height: h } = this.size, now = new Date(), hour = now.getHours();
    const night = hour >= 19 || hour < 6;
    const { k, cols, rows } = fit(list.length, w, h);
    const sw = Math.round(SLOT_W * k), sh = Math.round(SLOT_H * k), s = Math.max(1, Math.round(3 * k));
    const left = Math.round((w - cols * sw) / 2), top = WALL + Math.round(40 * k);
    this.geo = { k, s, sh, top, rows, topY: WALL - 40, leftX: Math.max(4, left - 16 * s - 6), rightX: Math.min(w - 16 * s - 4, left + cols * sw + 6) };
    const slots = Math.max(cols, rows * cols);
    const at = (i) => ({ x: left + (i % cols) * sw, y: top + Math.floor(i / cols) * sh });

    // Newcomers walk in through the door.
    const ts = Date.now();
    list.forEach((a, i) => {
      this.seats[a.address] = { x: at(i).x + Math.round(61 * k), y: at(i).y + Math.round(50 * k), row: Math.floor(i / cols) };
      if (this.known && !this.known.has(a.address)) {
        const door = this.spotPlace({ key: "door", jx: 0 });
        const path = [{ x: door.x, y: this.laneY(-1), r: -1, ms: 16 }, ...this.path(door, this.seatPlace(a.address))];
        this.trips[a.address] = { phase: "enter", spot: { key: "door" }, path, i: 0, until: ts + 700 };
        this.door = ts + 4000;
      }
    });
    this.known = new Set(list.map((a) => a.address));
    for (const key of Object.keys(this.trips)) if (!this.known.has(key)) delete this.trips[key];
    for (const t of Object.values(this.trips)) if (t.phase === "enter" && ts >= t.until) t.phase = "back";

    const c = this.cat, cp = c.path?.[c.i] ?? { x: Math.round(w / 3), y: this.geo.topY, ms: 16 };
    const hovered = list.find((a) => a.address === this.hover);
    return div().id("office-root").relative().size_full().overflow_hidden().bg("#e2a465")
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .children(room(w, h, { seed: this.seed, now, doorOpen: this.door > ts }))
      .children(Array.from({ length: slots }, (_, i) => this.desk(list[i], i, at(i).x, at(i).y, k, night)))
      .children(list.map((a, i) => this.label(a, at(i).x, at(i).y, k)))
      .child(div().id("cat").absolute().left(cp.x).top(cp.y + Math.round(30 * k))
        .transition("left", { duration: cp.ms, easing: "linear" }).transition("top", { duration: cp.ms, easing: "linear" })
        .child(cat(c.coat, s, c.left)))
      .children(list.map((a) => this.worker(a, k, s)))
      .when(night, (e) => e.child(r(0, 0, w, h, "#0b123650")))
      .when(hour >= 17 && hour < 19, (e) => e.child(r(0, 0, w, h, "#f2a65a1a")))
      .children(list.flatMap((a, i) => a.status !== "blocked" ? [] : [
        h_flex().absolute().left(at(i).x + Math.round(40 * k)).top(at(i).y - 26).gap(6).px(8).py(4).bg("#fff8e1").border(3).border_color("#a8322a").items_center()
          .child(icon(a.program, 14)).child(txt("NEEDS YOU", 12, "#a8322a")).id(`need-${a.address}`).loop("top", { from: at(i).y - 26, to: at(i).y - 32, period: 900 })]))
      .when(!!hovered, (e) => {
        const i = list.indexOf(hovered), x = Math.min(at(i).x + sw - 10, w - 200);
        return e.child(v_flex().absolute().left(x).top(at(i).y).w(180).p(8).gap(4).bg("#fff27a").border(2).border_color("#d8c440")
          .child(txt(hovered.tab_name, 12, ink).truncate())
          .child(txt(hovered.space_name ?? "", 12, "#6b5a4a").truncate())
          .when(!!hovered.title, (e) => e.child(txt(hovered.title, 12, "#6b5a4a").truncate()))
          .child(txt(hovered.status.toUpperCase(), 12, hovered.status === "blocked" ? "#a8322a" : ink)));
      })
      .child(v_flex().absolute().left(16).top(14).gap(4).p(8).bg("#fbfbf6").border(3).border_color("#6b3f1f")
        .child(txt("THE OFFICE", 16)).child(txt(`${list.length} on the clock`, 12, "#6b5a4a")));
  }
}

const bubble = (content) => div().absolute().px(4).py(2).bg("#ffffff").border(2).border_color(ink).child(content);
