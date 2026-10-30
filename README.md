# herdr-office-layout

The **Office** layout for the Herdr app: a pixel-art office where every coding agent is a little
office worker at a desk. Typing, stuck waiting on you, dozing after a finished job, or off at the
water cooler: you can tell at a glance. See [office/RECIPE.md](office/RECIPE.md) for how it is
built.

![Office](office/preview.png)

## Installation

Ask your agent to add this layout (it reads every file first), or by hand:

1. Copy `office/layouts/*` into `~/.config/herdr-app/layouts/`.
2. Copy `office/mods/office` into `~/.config/herdr-app/mods/`.
3. Pick **office** in the Herdr settings, or run:
   ```sh
   herdr-app do layout.switch --name office
   ```

`ctrl-shift-l` cycles back to your previous layout. Delete the copies to remove it.

Nothing to install: the pixel font ships with the mod. It makes no network requests, runs no
programs of its own and reads no files outside its folder. Clicking an empty desk opens a new tab
running your most-used installed agent (Herdr's `tab.new`).

## The office

| Worker | Screen | Agent status |
| --- | --- | --- |
| Bobbing at the keyboard, coffee steaming | green, code scrolling | working |
| Jumping, **NEEDS YOU** sign over the desk | red `!` | blocked: waiting for you |
| Head down, `zZz` | blue `OK` | done while you weren't looking |
| Sitting still, or out wandering | dim, blinking cursor | idle |

- Idle workers (and now and then finished ones) get up and wander: to the water cooler (back with
  a cup), a bookshelf (with a book), the window, the door, the plant, or another worker's desk for
  a chat. They keep to the walkways and hurry back when their agent starts working.
- New agents walk in through the door to their desk.
- Every worker looks different (hair, skin, hairstyle, glasses), and their shirt colour follows the
  kind of agent. Desks get random clutter, and an office cat roams the floor.
- The clock shows the real time, the window goes from day to sunset to night, and the room dims
  at night while desk lamps come on.
- Click a worker to jump to that agent. Hover a desk for a sticky note with its tab, space, title
  and status.
- Desks sit in two rows (more when needed) and shrink to fit any number of agents.

Under the office a wood strip shows the current space and tab, and your terminals sit below in
wood frames.

## Credits

- Font: [PxPlus IBM VGA 8x16](https://int10h.org/oldschool-pc-fonts/) by VileR, CC BY-SA 4.0
  (licence in `office/mods/office/fonts/`).

## License

Code: [MIT](LICENSE). The bundled font keeps its own CC BY-SA 4.0 licence.
