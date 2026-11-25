// Centralized course registry.
// To add a new course, append an entry here (and place its data files in public/assets/ for type: 'real').

export const COURSES = [
  {
    id: 'valley',
    name: 'Alpine Valley',
    shortName: 'Valley',
    subtitle: 'Procedural mountain valley loop with pine forests & meadows',
    badge: 'Procedural',
    type: 'procedural',
    winter: false,
    startDistance: 0,
    loadingText: 'Building the valley…',
  },
  {
    id: 'valley-christmas',
    name: 'Alpine Valley — Christmas',
    shortName: 'Christmas',
    subtitle: 'Snowy dusk, lit chalets, fairy-lit pines & falling snow',
    badge: 'Winter',
    type: 'procedural',
    winter: true,
    startDistance: 0,
    loadingText: 'Building the winter valley…',
  },
  {
    id: 'leckhampton',
    name: 'Leckhampton Hill',
    shortName: 'Leckhampton',
    subtitle: 'Real Cotswold climb from surveyed terrain & OpenStreetMap',
    badge: 'Real Road',
    type: 'real',
    dataId: 'leckhampton',
    winter: false,
    startDistance: 850,
    loadingText: 'Building Leckhampton Hill…',
  },
];

let personalCourses = [];

export function setPersonalCourses(list) {
  personalCourses = Array.isArray(list) ? list : [];
}

export function getAllCourses() {
  return [...COURSES, ...personalCourses];
}

export function resolveCourseFromSearch(search = window.location.search) {
  const params = new URLSearchParams(search);
  const requestedId = params.get('course');
  const all = getAllCourses();
  if (requestedId) {
    const match = all.find((c) => c.id === requestedId);
    if (match) return match;
  }
  if (params.get('theme') === 'christmas') {
    return COURSES.find((c) => c.id === 'valley-christmas') || COURSES[0];
  }
  return COURSES[0];
}

export function getCourseById(id) {
  return getAllCourses().find((c) => c.id === id) || null;
}
