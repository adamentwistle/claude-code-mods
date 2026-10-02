// Office: the drag layer. A Client laid over the office picture: it holds
// the pointer from a press to its release, draws a ghost of the desk being
// moved next to the pointer, and posts what happened to the hooks module,
// which owns the seats. A press and release without moving is a click.
//
// props.hits: [left, top, width, height, label, seat] per seat, in cells.

export default function OfficeDrag(props, surface) {
  const { Box, Text } = surface.elements;
  const hits = Array.isArray(props?.hits) ? props.hits : [];
  const s = surface.state ?? {};
  // The seat under a cell, from the hits this drawing was made with: the
  // same rectangles the floor shows, so the hooks never guess from a plan
  // drawn since. -1 off every desk.
  const seatAt = (x, y) => {
    const hit = hits.find((h) => x >= h[0] && x < h[0] + h[2] && y >= h[1] && y < h[1] + h[3]);
    return hit && Number.isInteger(hit[5]) ? hit[5] : -1;
  };

  surface.onPointer((e) => {
    const cur = surface.state ?? {};
    if (e.type === "down" && e.button === "left") {
      surface.setState({ x0: e.x, y0: e.y, x: e.x, y: e.y, isDown: true, isMoved: false });
    } else if (e.type === "move" && cur.isDown) {
      const isMoved = cur.isMoved || Math.abs(e.x - cur.x0) + Math.abs(e.y - cur.y0) > 1;
      surface.setState({ ...cur, x: e.x, y: e.y, isMoved });
      if (isMoved) surface.post({ type: "hover", from: [cur.x0, cur.y0], at: [e.x, e.y], fromSeat: seatAt(cur.x0, cur.y0), atSeat: seatAt(e.x, e.y) });
    } else if (e.type === "up" && cur.isDown) {
      surface.post(
        cur.isMoved
          ? { type: "drop", from: [cur.x0, cur.y0], to: [e.x, e.y], fromSeat: seatAt(cur.x0, cur.y0), toSeat: seatAt(e.x, e.y) }
          : { type: "click", at: [cur.x0, cur.y0], atSeat: seatAt(cur.x0, cur.y0) },
      );
      surface.setState({});
    }
  });

  const children = [];
  if (s.isDown && s.isMoved) {
    const hit = hits.find((h) => s.x0 >= h[0] && s.x0 < h[0] + h[2] && s.y0 >= h[1] && s.y0 < h[1] + h[3]);
    const label = ` ${hit ? String(hit[4]).slice(0, 24) : "desk"} `;
    const left = Math.max(0, Math.min(s.x + 1, (surface.columns || 80) - label.length));
    children.push(
      Box({
        key: "ghost",
        position: "absolute",
        top: Math.max(0, s.y),
        left,
        children: [Text({ inverse: true, bold: true, children: label })],
      }),
    );
  }
  return Box({ flexDirection: "column", children });
}
