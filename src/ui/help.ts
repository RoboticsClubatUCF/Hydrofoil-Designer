/** Plain-language explanations for the info buttons and the guided tour. */
import type { GroupId, Requirements } from '../solver/types';
import type { ResultsTab } from '../state/ui';

/** One short explanation per design value, keyed by the main-foil id. */
export const FIELD_HELP: Record<string, string> = {
  // water
  T: 'How warm the water is. It changes how heavy and how runny the water is, and how easily it boils into bubbles. If you are not sure, 15–20 °C (60–68 °F) is a fair guess.',
  rho: 'How heavy the water is for its size. Salt water is a little heavier than fresh water. Filled in for you from the temperature and water type.',
  nu: 'How runny the water is. Cold water is slightly thicker than warm water. Filled in for you from the temperature and water type.',
  pv: 'The pressure at which the water boils into bubbles at this temperature. If the pressure on the foil drops below this, bubbles form (cavitation).',
  patm: 'The air pressing down on the water surface. At sea level it is about 101 kPa (14.7 psi).',

  // load
  m: 'The total weight to lift: rider, board, foil and anything you carry. For one person on a foil board this is usually 80–110 kg (175–240 lb).',
  share:
    'How much of the total weight this foil holds up. With one foil it is 100 %. With a small back foil, the front foil carries most of the weight.',
  share2:
    'How much of the total weight the second foil holds up. The main foil carries the rest. A small back foil usually carries only a little.',
  L: 'The upward push this foil has to make to hold up its share of the weight while cruising.',

  // speed
  V: 'The speed you want to ride at most of the time. Foil boards often cruise at 15–30 km/h (4–8 m/s, 9–19 mph).',
  Vto: 'The slowest speed at which the foil can lift you out of the water. A lower take-off speed makes it easier to get going, but usually needs a bigger foil.',
  q: 'How hard the moving water presses on the foil at cruise speed. Going twice as fast makes it four times as big.',
  ReTo: 'The Reynolds number at take-off speed. It is used to look up how well the foil shape lifts when going slowly.',

  // size and shape
  b: 'Width of the foil from one tip to the other. Front wings on foil boards are often 60–100 cm (24–40 in). Wider foils make less drag but bend more.',
  cr: 'Length of the foil from front to back at the middle, where it joins the mast. Often 12–25 cm (5–10 in) on foil boards.',
  ct: 'Length of the foil from front to back at the tips.',
  lambda:
    'Tip length divided by middle length. 1 means the foil is the same length everywhere; 0.5 means the tips are half as long as the middle.',
  cbar: 'The average front-to-back length: area divided by width.',
  mac: 'A weighted average of the front-to-back length, used in some of the calculations. You do not need to set it.',
  S: 'The area of the foil seen from above. More area gives more lift, so it takes off sooner, but it also adds drag.',
  AR: 'How long and slim the foil is (width × width ÷ area). High values (8 or more) are long and slim: efficient, but they bend more. Low values (4–6) are short and wide: sturdy and easy to turn.',
  tRoot:
    'How thick the foil is at the middle, measured at its thickest point. Thicker is stronger and stiffer, but adds a little drag.',
  tTip: 'How thick the foil is at the tips.',

  // operating point
  alpha:
    'How much the foil is tilted nose-up compared with the water flowing past it. More tilt makes more lift, until the foil stalls. At cruise it is usually a few degrees.',
  CL: 'A number for how hard the foil is working to make lift, whatever its size or speed. Around 0.2–0.6 is normal at cruise. Higher means it is closer to stalling.',
  h: 'How deep the foil sits under the water surface while riding. Close to the surface it loses some lift and can suck in air. Foil boards often ride 30–70 cm (1–2 ft) deep.',
  Re: 'A number that describes how the water flows over the foil at this size and speed. It is worked out for you and is used to look up how the foil shape behaves.',
  hc: 'Foil depth divided by its front-to-back length. Below about 1, the nearby surface starts to take away some lift.',
  kFS: 'How much lift is left because the foil is near the surface. 1 means no loss; 0.9 means 10 % less lift than in deep water.',

  // from the section
  tc: 'How thick the foil shape is compared with its front-to-back length. 12 % means the thickest part is 12 % of the length.',
  alphaL0:
    'The tilt at which this foil shape makes no lift. Curved shapes still lift a little when level, so this is usually a small negative angle.',
  a0: 'How quickly lift grows as this foil shape is tilted more, before it stalls.',
  clmax:
    'The most lift this foil shape can make before the water stops following its surface and it stalls.',
  clmaxTo:
    'The most lift this foil shape can make at take-off speed. It is often a little lower when going slowly.',
  cm0: 'How much the foil shape tries to twist nose-down while it makes lift. The mast and back foil have to hold against this.',
  A1: 'The area of the cut-through foil shape for a foil 1 unit long from front to back. Used to work out the weight.',
  Z1: 'How well the cut-through shape resists bending, for a foil 1 unit long. Used to work out the strength.',
  I1: 'How stiff the cut-through shape is against bending, for a foil 1 unit long. Used to work out how much it bends.',

  // performance
  D: 'How hard the water pulls the foil backward at cruise. Less drag means less effort to keep going.',
  P: 'The power needed to push the foil through the water at cruise (drag × speed). This is the foil alone; the mast and board add more.',
  LD: 'Lift divided by drag: how much weight the foil carries for each unit of drag. Higher is better.',
  stallMargin:
    'How many more degrees the foil can tilt before it stalls and suddenly loses lift. A few degrees spare leaves room for waves and turns.',
  CLmax: 'The most lift the whole foil can make before part of it stalls.',
  CDp: 'The part of the drag that comes from the water rubbing along the surface and flowing around the thickness of the foil.',
  CDi: 'The part of the drag that comes from making lift. Water spills around the tips and swirls behind them. Wider foils have less of it.',
  CD: 'Total drag, written as a number that does not depend on size or speed.',
  alphaStall: 'The tilt at which the foil stalls and suddenly loses lift.',
  CLa: 'How quickly the whole foil’s lift grows per degree of tilt.',
  e: 'How evenly the lift is spread from the middle to the tips. 1 is the ideal spread with the least drag.',
  kPeak:
    'How much harder the busiest part of the foil works compared with the average. That part stalls first.',
  CLmaxTo: 'The most lift the whole foil can make at take-off speed.',

  // cavitation
  cavMargin:
    'Above zero: no bubbles expected at cruise. Below zero: the water is predicted to boil into bubbles on top of the foil, which loses lift, adds drag and can damage the surface.',
  Vcav: 'The speed at which bubbles are predicted to start forming on the foil. Stay below it.',
  sigma:
    'How much pressure the water has to spare before it boils, compared with the push of the flow. Deeper and slower means more to spare.',
  cpMin:
    'The lowest pressure on the foil surface, written as a number that does not depend on speed. It is compared with the cavitation number to check for bubbles.',
  clPeak: 'How hard the busiest part of the foil is working, along its width.',

  // structure
  SF: 'How much stronger the foil is than it needs to be. 2 means it could take twice the cruise load before the material gives. Type a value to have the foil sized for it.',
  sigmaMax:
    'The highest strain inside the material from bending. It must stay well below the material strength.',
  deflTip: 'How far the foil tips bend upward under load at cruise.',
  massFoil:
    'How much the foil wing weighs if it is made solid from the chosen material. The mast is not included.',
  Mroot: 'The bending load on the foil where it joins the mast. This is where foils usually break.',
  deflRatio:
    'How far the tips bend compared with half the width. More than a few percent means the foil is quite bendy.',
  etaBar:
    'Where the lift on each half of the foil is centred, as a fraction of the way from the middle to the tip.',
  kSigma:
    'Shows where the highest strain is: 1 means at the middle; above 1 means further out along the foil.',
  E: 'How stiff the material is. Higher bends less. Set by the material you pick.',
  sy: 'How much strain the material can take before it bends for good or breaks. Set by the material you pick.',
  rhoM: 'How heavy the material is for its size. Set by the material you pick.',

  // both foils
  VtoCraft: 'The speed at which both foils together can lift the craft out of the water.',
  Dtot: 'The drag of both foils added together at cruise.',
  Ptot: 'The power needed to push both foils through the water at cruise.',
  LDtot: 'Total lift divided by total drag for both foils. Higher is better.',
  massTot: 'The weight of both foil wings together.',
  VcavCraft: 'The speed at which bubbles start forming on either foil, whichever comes first.',
};

/** What each group in the design form is about. */
export const GROUP_HELP: Record<GroupId, string> = {
  load: 'Start here. Enter the total weight of rider, board and gear.',
  speed:
    'Enter the speed you want to ride at. You can also enter a take-off speed if you want the foil to lift you out of the water by a certain speed.',
  planform:
    'The outline of the foil seen from above. Leave these blank and the program picks a size for you, or type the ones you want to fix, such as the width.',
  operating:
    'How the foil sits in the water while cruising: its tilt, how hard it is working, and how deep it is. Entering the depth also turns on the cavitation check.',
  performance:
    'How well the design works: drag, power and how close it is to stalling. Usually you leave these blank and read them.',
  craft: 'Totals for the main and second foil working together.',
  surface:
    'Cavitation is when the pressure on top of the foil drops so low that the water boils into bubbles, even when it is cold. It happens at high speed or close to the surface, and it costs lift, adds drag and can pit the surface. It needs the foil depth (under Operating point).',
  structure:
    'Checks that the foil is strong and stiff enough. It assumes a solid foil made of the material you pick, held in the middle by a mast.',
  water: 'The kind of water and its temperature. The starting values are fine for most uses.',
  section: 'Values read from the foil shape you loaded in step 1. They are filled in for you.',
};

export const PLANFORM_HELP =
  'The outline of the foil seen from above. Rectangular: the same length everywhere, the easiest to build. Tapered: shorter at the tips, which spreads the lift better. Elliptical: a smooth rounded outline, the most efficient but the hardest to build.';

export const MATERIAL_HELP =
  'What the foil is made of. It sets how strong, stiff and heavy the foil is. Pick Custom to type your own values.';

export const WATER_HELP =
  'Fresh water (lakes, rivers), brackish (river mouths) or sea water. Salt makes the water slightly heavier, which adds a little lift.';

/** The results tabs, also used by the guided tour. */
export const TAB_HELP: Record<ResultsTab, string> = {
  overview:
    'The main numbers at a glance and a drawing of the foil seen from above. Click any number to find it in the design form.',
  section:
    'Charts for the foil shape: how the water pressure spreads over it, and how its lift and drag change as it tilts.',
  span: 'How lift, bending and strain change from the middle of the foil out to the tips. Use it to check the foil is strong enough.',
  sweep:
    'How your foil behaves at other speeds: the tilt it needs, its drag and the power it takes. Marks show take-off, cruise and where bubbles would start.',
  flow3d:
    'An animated 3D view of water flowing past your foil. Drag to turn the view and scroll to zoom. The controls underneath let you try other speeds, weights and waves without changing your design.',
  calc: 'Every value with its formula and the numbers used, in one list. You can copy, download or print it.',
  export:
    'Download your foil as a drawing for CAD software or a CNC machine, as point lists, as a report, or as a design file to open again later.',
};

/** The limits in the requirements card. */
export const REQUIREMENT_HELP: Record<keyof Requirements, string> = {
  spanMax: 'The widest the foil may be, tip to tip.',
  rootChordMax: 'The longest the foil may be from front to back at the middle.',
  rootChordMin:
    'The shortest the foil may be from front to back at the middle, for example so it fits your mast.',
  thicknessMin: 'The thinnest the foil may be at the middle, for example to leave room for bolts.',
  sfMin:
    'How much stronger than needed the foil must be. 2 means it must take twice the cruise load.',
  takeoffMax: 'The highest take-off speed you will accept. A lower limit makes the foil bigger.',
  stallMarginMin: 'How many degrees of extra tilt must be left at cruise before the foil stalls.',
  arMin:
    'The lowest aspect ratio (width × width ÷ area) you will accept. Lower means shorter and wider.',
  arMax:
    'The highest aspect ratio (width × width ÷ area) you will accept. Higher means longer and slimmer.',
  deflectionMax: 'How far the tips may bend, as a share of half the width.',
  noCavitation:
    'Make sure no bubbles form on the foil at cruise. It needs the foil depth, which you enter under Design → Operating point.',
};
