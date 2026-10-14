// The demo Library: well-known public songs with fake ids. BPM, key and energy
// are rough, believable values, not measurements. The first 116 tracks come
// from the proposals fixture (so the sample Proposals point at real rows); the
// rest are added here to reach ten genres.
import { sampleTracks } from '../features/proposals/fixtures/seed.ts';

export type GenreId =
  | 'indie'
  | 'house'
  | 'hiphop'
  | 'jazzfunk'
  | 'downtempo'
  | 'synthpop'
  | 'classicrock'
  | 'alt90s'
  | 'disco'
  | 'pop';

type Range = [number, number];

export interface Genre {
  id: GenreId;
  /** Artist tags, most typical first. */
  tags: string[];
  valence: Range;
  dance: Range;
  acoustic: Range;
  instr: Range;
  loudness: Range;
}

export const GENRES: Record<GenreId, Genre> = {
  indie: { id: 'indie', tags: ['indie rock', 'garage rock revival', 'post-punk revival', '2000s'], valence: [0.4, 0.75], dance: [0.4, 0.65], acoustic: [0, 0.1], instr: [0, 0.05], loudness: [-6, -3.5] },
  house: { id: 'house', tags: ['deep house', 'house', 'electronic', 'uk garage'], valence: [0.3, 0.7], dance: [0.7, 0.9], acoustic: [0, 0.1], instr: [0.3, 0.85], loudness: [-9, -6] },
  hiphop: { id: 'hiphop', tags: ['hip hop', 'boom bap', 'east coast hip hop', 'jazz rap'], valence: [0.45, 0.8], dance: [0.7, 0.88], acoustic: [0.05, 0.3], instr: [0, 0.05], loudness: [-8, -5] },
  jazzfunk: { id: 'jazzfunk', tags: ['jazz funk', 'soul', 'funk', 'neo soul'], valence: [0.5, 0.85], dance: [0.55, 0.75], acoustic: [0.2, 0.6], instr: [0.05, 0.6], loudness: [-12, -8] },
  downtempo: { id: 'downtempo', tags: ['trip hop', 'downtempo', 'ambient', 'electronic'], valence: [0.08, 0.4], dance: [0.3, 0.6], acoustic: [0.2, 0.8], instr: [0.5, 0.95], loudness: [-15, -9] },
  synthpop: { id: 'synthpop', tags: ['new wave', 'synth-pop', '80s', 'post-punk'], valence: [0.45, 0.85], dance: [0.55, 0.78], acoustic: [0, 0.15], instr: [0, 0.2], loudness: [-10, -7] },
  classicrock: { id: 'classicrock', tags: ['classic rock', 'rock', 'hard rock', 'blues rock', '70s'], valence: [0.35, 0.75], dance: [0.35, 0.6], acoustic: [0.05, 0.4], instr: [0, 0.1], loudness: [-11, -7] },
  alt90s: { id: 'alt90s', tags: ['alternative rock', 'britpop', 'grunge', '90s'], valence: [0.2, 0.6], dance: [0.35, 0.55], acoustic: [0, 0.3], instr: [0, 0.05], loudness: [-8, -5] },
  disco: { id: 'disco', tags: ['disco', 'nu disco', 'funk', 'boogie'], valence: [0.7, 0.95], dance: [0.7, 0.9], acoustic: [0.02, 0.2], instr: [0, 0.2], loudness: [-9, -6] },
  pop: { id: 'pop', tags: ['pop', 'dance pop', 'electropop', 'alt pop'], valence: [0.35, 0.8], dance: [0.6, 0.82], acoustic: [0, 0.3], instr: [0, 0.02], loudness: [-6, -3.5] },
};

export interface CatalogTrack {
  id: string;
  name: string;
  artists: string[];
  album: string;
  year: number;
  durationMs: number;
  bpm: number | null;
  key: number;
  mode: 0 | 1;
  energy: number;
  genre: GenreId;
}

// Album names for the fixture tracks (fixture000000000000001 … 116), in order.
const FIXTURE_ALBUMS = [
  "Whatever People Say I Am, That's What I'm Not", 'Is This It', 'Room on Fire', 'Fever to Tell', 'Antics',
  'Franz Ferdinand', 'Hot Fuss', 'Silent Alarm', 'Sound of Silver', 'Wolfgang Amadeus Phoenix',
  'Vampire Weekend', 'Oracular Spectacular', 'Good News for People Who Love Bad News', 'Elephant', 'Funeral',
  'Youth and Young Manhood', 'Silent Alarm', 'Favourite Worst Nightmare', 'The Libertines', "It's Blitz!",
  'Turn On the Bright Lights', 'Is This It', 'Settle', 'Rain', 'Can You Feel It',
  'Silentintroduction', 'Nuits Sonores / Nectarines', 'Breathing', 'Bicep', 'Apricots',
  'Little by Little', 'Actual Life (April 14 - December 17 2020)', 'Actual Life 3 (January 1 - September 9 2022)', 'Once', 'Channel Tres',
  'In Colour', 'In Colour', 'Sixteen Oceans', 'New Energy', 'BUBBA',
  'Inspector Norse', 'Knock Knock', 'Our Love', 'Midnight Marauders', "People's Instinctive Travels and the Paths of Rhythm",
  'Illmatic', 'Illmatic', 'The Infamous', 'Ready to Die', 'Enter the Wu-Tang (36 Chambers)',
  '3 Feet High and Rising', 'Hard to Earn', 'Mecca and the Soul Brother', 'Bizarre Ride II the Pharcyde', 'Reachin\' (A New Refutation of Time and Space)',
  'Resurrection', 'Black on Both Sides', 'Mos Def & Talib Kweli Are Black Star', 'ATLiens', '2001',
  'The Miseducation of Lauryn Hill', 'Things Fall Apart', "93 'til Infinity", 'Everybody Loves the Sunshine', 'Head Hunters',
  'Places and Spaces', 'Expansions', 'Menagerie', "What's Going On", 'Curtis',
  'Innervisions', 'Adventures in Paradise', 'Go for Your Guns', 'Light as a Feather', 'Con Todo El Mundo',
  'Texas Sun', 'Geography', 'Harmony of Difference', 'IV', 'Drunk',
  'Baduizm', 'Brown Sugar', 'Mezzanine', 'Dummy', 'Music Has the Right to Children',
  'Migration', 'The North Borders', 'Awake', 'Spaces', 'Untrue',
  'Moon Safari', 'Simple Things', 'Sounds from the Thievery Hi-Fi', 'Play', 'Drukqs',
  'Singularity', 'Persona', 'xx', 'II', 'Looped',
  'Blue Monday', 'Speak & Spell', 'Songs from the Big Chair', 'Hunting High and Low', 'Kiss Me, Kiss Me, Kiss Me',
  'Remain in Light', 'Hounds of Love', 'Sweet Dreams (Are Made of This)', "Don't You (Forget About Me)", 'Please',
  'Love Will Tear Us Apart', 'Non-Stop Erotic Cabaret', 'Dare', 'Ocean Rain', 'Rio',
  'Kick',
];

const FIXTURE_GENRE: Record<string, GenreId> = {
  'indie rock': 'indie',
  'deep house': 'house',
  'hip hop': 'hiphop',
  'jazz funk': 'jazzfunk',
  'trip hop': 'downtempo',
  'new wave': 'synthpop',
};

// artists (separated by "; ") | title | album | year | bpm | key | mode | energy | m:ss
type Row = [string, string, string, number, number, number, 0 | 1, number, string];

const EXTRA: Record<Exclude<GenreId, 'indie' | 'house' | 'hiphop' | 'jazzfunk' | 'downtempo' | 'synthpop'>, Row[]> = {
  classicrock: [
    ['Fleetwood Mac', 'Dreams', 'Rumours', 1977, 120, 5, 1, 0.49, '4:17'],
    ['Fleetwood Mac', 'The Chain', 'Rumours', 1977, 152, 4, 0, 0.73, '4:30'],
    ['Fleetwood Mac', 'Go Your Own Way', 'Rumours', 1977, 135, 5, 1, 0.83, '3:38'],
    ['Led Zeppelin', 'Whole Lotta Love', 'Led Zeppelin II', 1969, 90, 4, 1, 0.82, '5:34'],
    ['Led Zeppelin', 'Immigrant Song', 'Led Zeppelin III', 1970, 113, 6, 0, 0.92, '2:26'],
    ['Led Zeppelin', 'Kashmir', 'Physical Graffiti', 1975, 80, 2, 1, 0.71, '8:37'],
    ['Queen', 'Bohemian Rhapsody', 'A Night at the Opera', 1975, 72, 10, 1, 0.4, '5:55'],
    ['Queen', "Don't Stop Me Now", 'Jazz', 1978, 156, 5, 1, 0.87, '3:29'],
    ['Queen', 'Another One Bites the Dust', 'The Game', 1980, 110, 4, 0, 0.53, '3:35'],
    ['David Bowie', '"Heroes"', '"Heroes"', 1977, 113, 2, 1, 0.76, '6:07'],
    ['David Bowie', 'Life on Mars?', 'Hunky Dory', 1971, 65, 5, 1, 0.42, '3:48'],
    ['David Bowie', 'Starman', 'The Rise and Fall of Ziggy Stardust and the Spiders from Mars', 1972, 102, 5, 1, 0.6, '4:16'],
    ['The Rolling Stones', 'Gimme Shelter', 'Let It Bleed', 1969, 118, 1, 0, 0.8, '4:31'],
    ['The Rolling Stones', 'Paint It Black', 'Aftermath', 1966, 158, 4, 0, 0.89, '3:22'],
    ['The Rolling Stones', 'Start Me Up', 'Tattoo You', 1981, 122, 5, 1, 0.86, '3:33'],
    ['Pink Floyd', 'Wish You Were Here', 'Wish You Were Here', 1975, 60, 7, 1, 0.33, '5:34'],
    ['Pink Floyd', 'Money', 'The Dark Side of the Moon', 1973, 123, 11, 0, 0.62, '6:22'],
    ['Pink Floyd', 'Comfortably Numb', 'The Wall', 1979, 64, 11, 0, 0.45, '6:22'],
    ['Eagles', 'Hotel California', 'Hotel California', 1976, 75, 11, 0, 0.51, '6:30'],
    ['Lynyrd Skynyrd', 'Sweet Home Alabama', 'Second Helping', 1974, 98, 7, 1, 0.77, '4:43'],
    ['Creedence Clearwater Revival', 'Fortunate Son', 'Willy and the Poor Boys', 1969, 133, 0, 1, 0.66, '2:20'],
    ['Creedence Clearwater Revival', 'Have You Ever Seen the Rain', 'Pendulum', 1970, 116, 0, 1, 0.69, '2:40'],
    ['AC/DC', 'Highway to Hell', 'Highway to Hell', 1979, 116, 9, 1, 0.91, '3:28'],
    ['AC/DC', 'Back in Black', 'Back in Black', 1980, 94, 4, 1, 0.94, '4:15'],
    ['The Who', "Baba O'Riley", "Who's Next", 1971, 117, 5, 1, 0.74, '5:08'],
    ['The Doors', 'Riders on the Storm', 'L.A. Woman', 1971, 105, 4, 0, 0.45, '7:14'],
    ['The Jimi Hendrix Experience', 'All Along the Watchtower', 'Electric Ladyland', 1968, 113, 8, 0, 0.81, '4:00'],
    ['Boston', 'More Than a Feeling', 'Boston', 1976, 109, 7, 1, 0.68, '4:45'],
    ['Tom Petty', "Free Fallin'", 'Full Moon Fever', 1989, 84, 5, 1, 0.55, '4:14'],
    ['Dire Straits', 'Sultans of Swing', 'Dire Straits', 1978, 148, 5, 0, 0.79, '5:48'],
    ['Steely Dan', 'Do It Again', "Can't Buy a Thrill", 1972, 118, 7, 0, 0.53, '5:56'],
    ['Thin Lizzy', 'The Boys Are Back in Town', 'Jailbreak', 1976, 138, 1, 1, 0.81, '4:27'],
    ['Blue Öyster Cult', "(Don't Fear) The Reaper", 'Agents of Fortune', 1976, 141, 9, 0, 0.73, '5:08'],
    ['Deep Purple', 'Smoke on the Water', 'Machine Head', 1972, 114, 7, 0, 0.75, '5:40'],
    ['Bruce Springsteen', 'Born to Run', 'Born to Run', 1975, 147, 4, 1, 0.9, '4:31'],
    ['Elton John', 'Tiny Dancer', 'Madman Across the Water', 1971, 72, 0, 1, 0.44, '6:17'],
  ],
  alt90s: [
    ['Nirvana', 'Smells Like Teen Spirit', 'Nevermind', 1991, 117, 1, 1, 0.91, '5:01'],
    ['Nirvana', 'Come as You Are', 'Nevermind', 1991, 120, 4, 0, 0.82, '3:39'],
    ['Pearl Jam', 'Alive', 'Ten', 1991, 76, 2, 1, 0.84, '5:41'],
    ['Soundgarden', 'Black Hole Sun', 'Superunknown', 1994, 105, 7, 1, 0.68, '5:18'],
    ['Radiohead', 'Karma Police', 'OK Computer', 1997, 75, 7, 0, 0.45, '4:21'],
    ['Radiohead', 'Paranoid Android', 'OK Computer', 1997, 82, 7, 0, 0.6, '6:27'],
    ['Radiohead', 'Fake Plastic Trees', 'The Bends', 1995, 74, 9, 1, 0.34, '4:50'],
    ['Oasis', 'Wonderwall', "(What's the Story) Morning Glory?", 1995, 87, 6, 0, 0.83, '4:18'],
    ['Oasis', "Don't Look Back in Anger", "(What's the Story) Morning Glory?", 1995, 82, 0, 1, 0.84, '4:48'],
    ['Oasis', 'Live Forever', 'Definitely Maybe', 1994, 89, 7, 1, 0.88, '4:36'],
    ['Blur', 'Song 2', 'Blur', 1997, 130, 10, 1, 0.95, '2:02'],
    ['Blur', 'Girls & Boys', 'Parklife', 1994, 125, 4, 1, 0.84, '4:51'],
    ['Pulp', 'Common People', 'Different Class', 1995, 144, 0, 1, 0.83, '5:51'],
    ['The Verve', 'Bitter Sweet Symphony', 'Urban Hymns', 1997, 86, 9, 1, 0.91, '5:58'],
    ['Pixies', 'Where Is My Mind?', 'Surfer Rosa', 1988, 81, 4, 1, 0.68, '3:53'],
    ['Pixies', 'Here Comes Your Man', 'Doolittle', 1989, 121, 4, 1, 0.75, '3:21'],
    ['R.E.M.', 'Losing My Religion', 'Out of Time', 1991, 125, 9, 0, 0.62, '4:28'],
    ['The Smashing Pumpkins', '1979', 'Mellon Collie and the Infinite Sadness', 1995, 127, 3, 1, 0.71, '4:25'],
    ['The Smashing Pumpkins', 'Tonight, Tonight', 'Mellon Collie and the Infinite Sadness', 1995, 79, 7, 1, 0.66, '4:14'],
    ['Weezer', 'Buddy Holly', 'Weezer (Blue Album)', 1994, 121, 8, 1, 0.85, '2:39'],
    ['Beck', 'Loser', 'Mellow Gold', 1993, 86, 9, 1, 0.77, '3:55'],
    ['Red Hot Chili Peppers', 'Under the Bridge', 'Blood Sugar Sex Magik', 1991, 84, 4, 1, 0.46, '4:24'],
    ['Red Hot Chili Peppers', 'Californication', 'Californication', 1999, 96, 9, 0, 0.77, '5:29'],
    ['Foo Fighters', 'Everlong', 'The Colour and the Shape', 1997, 158, 11, 1, 0.88, '4:10'],
    ['Jeff Buckley', 'Hallelujah', 'Grace', 1994, 64, 7, 1, 0.18, '6:53'],
    ['The Cranberries', 'Linger', 'Everybody Else Is Doing It, So Why Can\'t We?', 1993, 92, 4, 1, 0.53, '4:34'],
    ['Green Day', 'Basket Case', 'Dookie', 1994, 171, 3, 1, 0.94, '3:01'],
    ['Garbage', 'Only Happy When It Rains', 'Garbage', 1995, 120, 2, 1, 0.8, '3:56'],
    ['Alanis Morissette', 'You Oughta Know', 'Jagged Little Pill', 1995, 105, 6, 0, 0.84, '4:09'],
    ['Stone Temple Pilots', 'Interstate Love Song', 'Purple', 1994, 83, 9, 0, 0.78, '3:14'],
    ['Elliott Smith', 'Between the Bars', 'Either/Or', 1997, 69, 9, 1, 0.16, '2:21'],
    ['Placebo', 'Every You Every Me', 'Without You I\'m Nothing', 1998, 133, 11, 0, 0.92, '3:33'],
    ['Supergrass', 'Alright', 'I Should Coco', 1995, 135, 7, 1, 0.9, '3:01'],
    ['Manic Street Preachers', 'A Design for Life', 'Everything Must Go', 1996, 88, 7, 1, 0.77, '4:16'],
    ['The Stone Roses', 'I Wanna Be Adored', 'The Stone Roses', 1989, 104, 4, 0, 0.62, '4:52'],
    ['Suede', 'Trash', 'Coming Up', 1996, 120, 4, 1, 0.88, '4:06'],
  ],
  disco: [
    ['Chic', 'Le Freak', "C'est Chic", 1978, 120, 9, 0, 0.71, '5:28'],
    ['Chic', 'Good Times', 'Risqué', 1979, 111, 4, 0, 0.63, '8:12'],
    ['Donna Summer', 'I Feel Love', 'I Remember Yesterday', 1977, 128, 0, 1, 0.75, '5:53'],
    ['Donna Summer', 'Hot Stuff', 'Bad Girls', 1979, 120, 6, 0, 0.77, '5:14'],
    ['Sister Sledge', 'We Are Family', 'We Are Family', 1979, 117, 8, 1, 0.74, '8:20'],
    ['Sister Sledge', 'Lost in Music', 'We Are Family', 1979, 119, 4, 0, 0.82, '4:51'],
    ['Bee Gees', "Stayin' Alive", 'Saturday Night Fever', 1977, 104, 5, 0, 0.71, '4:45'],
    ['Bee Gees', 'You Should Be Dancing', 'Children of the World', 1976, 124, 3, 0, 0.83, '4:16'],
    ['Earth, Wind & Fire', 'September', 'The Best of Earth, Wind & Fire, Vol. 1', 1978, 126, 9, 1, 0.83, '3:35'],
    ['Earth, Wind & Fire', 'Boogie Wonderland', 'I Am', 1979, 132, 0, 0, 0.88, '4:48'],
    ['Gloria Gaynor', 'I Will Survive', 'Love Tracks', 1978, 117, 9, 0, 0.6, '3:18'],
    ['ABBA', 'Dancing Queen', 'Arrival', 1976, 101, 9, 1, 0.68, '3:51'],
    ['ABBA', 'Gimme! Gimme! Gimme! (A Man After Midnight)', 'Voulez-Vous', 1979, 120, 2, 0, 0.75, '4:52'],
    ['Diana Ross', "I'm Coming Out", 'Diana', 1980, 109, 11, 0, 0.74, '5:25'],
    ['Michael Jackson', "Don't Stop 'Til You Get Enough", 'Off the Wall', 1979, 119, 11, 1, 0.82, '6:05'],
    ['Michael Jackson', 'Billie Jean', 'Thriller', 1982, 117, 6, 0, 0.66, '4:54'],
    ['Kool & The Gang', 'Celebration', 'Celebrate!', 1980, 121, 8, 1, 0.81, '4:58'],
    ['Rufus; Chaka Khan', 'Ain\'t Nobody', 'Stompin\' at the Savoy', 1983, 104, 4, 0, 0.71, '4:41'],
    ['Cheryl Lynn', 'Got to Be Real', 'Cheryl Lynn', 1978, 117, 7, 1, 0.73, '5:06'],
    ['Patrice Rushen', 'Forget Me Nots', 'Straight from the Heart', 1982, 113, 1, 0, 0.69, '4:39'],
    ['Lipps Inc.', 'Funkytown', 'Mouth to Mouth', 1979, 123, 0, 1, 0.82, '7:53'],
    ['Daft Punk', 'One More Time', 'Discovery', 2000, 123, 2, 1, 0.7, '5:20'],
    ['Daft Punk; Pharrell Williams; Nile Rodgers', 'Get Lucky', 'Random Access Memories', 2013, 116, 6, 0, 0.81, '6:09'],
    ['Daft Punk', 'Digital Love', 'Discovery', 2001, 125, 4, 1, 0.68, '5:01'],
    ['Jamiroquai', 'Virtual Insanity', 'Travelling Without Moving', 1996, 92, 3, 0, 0.71, '5:40'],
    ['Jamiroquai', 'Cosmic Girl', 'Travelling Without Moving', 1996, 119, 1, 0, 0.88, '4:05'],
    ['Purple Disco Machine; Sophie and the Giants', 'Hypnotized', 'Exotica', 2020, 120, 8, 0, 0.8, '3:22'],
    ['Róisín Murphy', "Murphy's Law", 'Róisín Machine', 2020, 120, 0, 0, 0.78, '6:13'],
    ['Todd Terje', 'Delorean Dynamite', "It's Album Time", 2014, 118, 9, 0, 0.82, '6:25'],
    ['Breakbot; Irfane', "Baby I'm Yours", 'By Your Side', 2012, 112, 9, 1, 0.73, '4:09'],
    ['Parcels', 'Tieduprightnow', 'Parcels', 2018, 116, 2, 0, 0.76, '4:22'],
    ['Jessie Ware', 'Spotlight', "What's Your Pleasure?", 2020, 118, 8, 0, 0.71, '4:17'],
    ['Chromeo', "Jealous (I Ain't With It)", 'White Women', 2014, 110, 11, 0, 0.85, '4:09'],
    ['Cerrone', 'Supernature', 'Supernature (Cerrone III)', 1977, 130, 9, 0, 0.69, '10:20'],
  ],
  pop: [
    ['Robyn', 'Dancing On My Own', 'Body Talk Pt. 1', 2010, 117, 6, 1, 0.87, '4:41'],
    ['Lorde', 'Royals', 'Pure Heroine', 2013, 85, 7, 1, 0.43, '3:10'],
    ['Lorde', 'Green Light', 'Melodrama', 2017, 129, 9, 1, 0.8, '3:54'],
    ['Carly Rae Jepsen', 'Run Away With Me', 'E•MO•TION', 2015, 150, 1, 1, 0.84, '4:11'],
    ['Carly Rae Jepsen', 'Call Me Maybe', 'Kiss', 2012, 120, 7, 1, 0.58, '3:13'],
    ['The Weeknd', 'Blinding Lights', 'After Hours', 2020, 171, 1, 1, 0.73, '3:20'],
    ['The Weeknd', "Can't Feel My Face", 'Beauty Behind the Madness', 2015, 108, 9, 0, 0.77, '3:35'],
    ['Dua Lipa', 'Levitating', 'Future Nostalgia', 2020, 103, 6, 0, 0.82, '3:23'],
    ['Dua Lipa', "Don't Start Now", 'Future Nostalgia', 2019, 124, 11, 0, 0.79, '3:03'],
    ['Harry Styles', 'As It Was', "Harry's House", 2022, 174, 6, 1, 0.73, '2:47'],
    ['Taylor Swift', 'Style', '1989', 2014, 95, 2, 1, 0.79, '3:51'],
    ['Taylor Swift', 'Cruel Summer', 'Lover', 2019, 170, 9, 1, 0.7, '2:58'],
    ['Billie Eilish', 'bad guy', 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?', 2019, 135, 7, 1, 0.43, '3:14'],
    ['Billie Eilish', 'Happier Than Ever', 'Happier Than Ever', 2021, 81, 2, 1, 0.31, '4:58'],
    ['Charli xcx', '360', 'BRAT', 2024, 120, 9, 1, 0.82, '2:13'],
    ['Charli xcx', 'Von dutch', 'BRAT', 2024, 132, 4, 0, 0.9, '2:43'],
    ['Olivia Rodrigo', 'good 4 u', 'SOUR', 2021, 166, 6, 1, 0.66, '2:58'],
    ['Olivia Rodrigo', 'drivers license', 'SOUR', 2021, 144, 10, 1, 0.43, '4:02'],
    ['Sabrina Carpenter', 'Espresso', "Short n' Sweet", 2024, 104, 0, 1, 0.76, '2:55'],
    ['Chappell Roan', 'Good Luck, Babe!', 'Good Luck, Babe!', 2024, 117, 4, 1, 0.58, '3:38'],
    ['Chappell Roan', 'HOT TO GO!', 'The Rise and Fall of a Midwest Princess', 2023, 110, 2, 1, 0.84, '3:04'],
    ['Kylie Minogue', 'Padam Padam', 'Tension', 2023, 128, 6, 0, 0.62, '2:46'],
    ['Lady Gaga', 'Bad Romance', 'The Fame Monster', 2009, 119, 9, 0, 0.92, '4:54'],
    ['Rihanna; Calvin Harris', 'We Found Love', 'Talk That Talk', 2011, 128, 1, 1, 0.77, '3:35'],
    ['Calvin Harris', 'Feel So Close', '18 Months', 2012, 128, 7, 1, 0.92, '3:26'],
    ['Mark Ronson; Bruno Mars', 'Uptown Funk', 'Uptown Special', 2014, 115, 0, 0, 0.61, '4:30'],
    ['Tame Impala', 'The Less I Know the Better', 'Currents', 2015, 117, 4, 1, 0.74, '3:36'],
    ['Tame Impala', 'Let It Happen', 'Currents', 2015, 125, 0, 1, 0.83, '7:47'],
    ['HAIM', 'The Wire', 'Days Are Gone', 2013, 104, 2, 1, 0.76, '4:05'],
    ['CHVRCHES', 'The Mother We Share', 'The Bones of What You Believe', 2013, 110, 6, 1, 0.84, '3:11'],
    ['Florence + The Machine', 'Dog Days Are Over', 'Lungs', 2008, 150, 7, 1, 0.71, '4:12'],
    ['Beyoncé', 'CUFF IT', 'RENAISSANCE', 2022, 115, 7, 1, 0.69, '3:45'],
    ['Doja Cat', 'Say So', 'Hot Pink', 2019, 111, 11, 0, 0.67, '3:57'],
    ['SZA', 'Kill Bill', 'SOS', 2022, 89, 8, 1, 0.73, '2:33'],
  ],
};

const toMs = (mss: string) => {
  const [m, s] = mss.split(':').map(Number);
  return (m! * 60 + s!) * 1000;
};

const fixtureId = (n: number) => `fixture${String(n).padStart(15, '0')}`;

/** All demo tracks: the 116 fixture tracks first, then the extra genres. */
export function catalog(): CatalogTrack[] {
  const fixtures: CatalogTrack[] = sampleTracks().map((t, i) => ({
    id: t.id,
    name: t.name,
    artists: t.artists,
    album: FIXTURE_ALBUMS[i] ?? t.name,
    year: t.year,
    durationMs: t.durationMs,
    bpm: t.bpm,
    key: t.key,
    mode: t.mode,
    energy: t.energy,
    genre: FIXTURE_GENRE[t.tags[0] ?? ''] ?? 'indie',
  }));
  let n = fixtures.length;
  const extra = (Object.entries(EXTRA) as [GenreId, Row[]][]).flatMap(([genre, rows]) =>
    rows.map(
      ([artists, name, album, year, bpm, key, mode, energy, dur]): CatalogTrack => ({
        id: fixtureId(++n),
        name,
        artists: artists.split('; '),
        album,
        year,
        durationMs: toMs(dur),
        bpm,
        key,
        mode,
        energy,
        genre,
      }),
    ),
  );
  return [...fixtures, ...extra];
}
