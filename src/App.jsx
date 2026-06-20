import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, Play, Target, BarChart2, Shuffle, Flame, Sun, Moon, LogOut,
  ChevronLeft, CheckCircle, AlertCircle, Zap, WifiOff, X, AlertTriangle,
  Eye, EyeOff, MessageCircle, Flag, Award, Users, Calendar, User,
  TrendingUp, Clock, Star, ChevronRight, Shield, BookOpen, Lock,
  RefreshCw, Copy
} from "lucide-react";
import { auth, db, track } from "./firebase";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
  signOut, onAuthStateChanged
} from "firebase/auth";
import {
  doc, getDoc, setDoc, updateDoc, addDoc,
  collection, query, where, getDocs, serverTimestamp, increment, arrayUnion, limit,
  onSnapshot
} from "firebase/firestore";

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
function scheduleNotif(title,body,delayMs){
  if(!("Notification" in window)||Notification.permission!=="granted")return;
  setTimeout(()=>{
    try{new Notification(title,{body,icon:"/icons/icon-192.png",badge:"/icons/icon-192.png"});}catch(e){}
  },Math.max(0,delayMs));
}

function setupNotifications(user){
  if(!("Notification" in window)||Notification.permission!=="granted")return;
  const now=new Date();

  // 8am — daily mission ready
  const next8am=new Date(now);next8am.setHours(8,0,0,0);
  if(next8am<=now)next8am.setDate(next8am.getDate()+1);
  scheduleNotif("Your JUPEB mission is ready 🔥","Open CrediQ and complete today's drill. Small steps = big score.",next8am-now);

  // 8pm — evening nudge
  const next8pm=new Date(now);next8pm.setHours(20,0,0,0);
  if(next8pm<=now)next8pm.setDate(next8pm.getDate()+1);
  scheduleNotif("You still have time 📚","Complete today's JUPEB mission before midnight.",next8pm-now);

  // 3-day inactivity check — fires 2s after app opens
  const lastActive=user?.lastActiveDate;
  if(lastActive){
    const daysSince=Math.floor((now-new Date(lastActive))/(1000*60*60*24));
    if(daysSince>=3){
      const weakTopic=user?.weakTopics?.[0]||"your weak topic";
      scheduleNotif(`${weakTopic} is waiting 👀`,`You haven't practiced in ${daysSince} days. That score gap is still there.`,2000);
    }
  }
}

async function requestNotifPermission(user){
  if(!("Notification" in window))return;
  if(Notification.permission==="granted"){setupNotifications(user);return;}
  if(Notification.permission==="denied")return;
  const perm=await Notification.requestPermission();
  if(perm==="granted")setupNotifications(user);
}

// ─── THEMES ──────────────────────────────────────────────────────────────────
const DARK = { bg:"#0a1410",bg2:"#0f2218",surface:"#1B3A2A",surface2:"#264D38",gold:"#B8973E",gold2:"#D4AE5A",text:"#F7F3EC",muted:"#9AA89A",border:"rgba(184,151,62,0.22)",danger:"#C0392B",success:"#4ade80",warn:"#f97316",navBg:"#0f2218",navBorder:"rgba(184,151,62,0.15)" };
const LIGHT = { bg:"#F5F0E8",bg2:"#EDE7D8",surface:"#FFFFFF",surface2:"#F0EBE0",gold:"#9A7A28",gold2:"#B8973E",text:"#1B2E1F",muted:"#8A988A",border:"rgba(154,122,40,0.22)",danger:"#C0392B",success:"#16a34a",warn:"#ea580c",navBg:"#1B3A2A",navBorder:"rgba(184,151,62,0.2)" };

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const FREE_DAILY_LIMIT = 50;
const EXAM_TIMES = { full:60,quick:25,drill:15,topic:15 };
const AMBASSADOR_COMMISSION = 500; // ₦500 credited to ambassador per premium referral
const WHATSAPP_LINK = "https://wa.me/2348028278538?text=Hi%20CrediQ%20support%2C%20I%20need%20help%20with%20";
const WA_COMMUNITY = "https://chat.whatsapp.com/EpM8Ia2CVkH3EHlFko62IE?s=cl&p=a&mlu=0&ilr=0";
const WA_CHANNEL   = "https://whatsapp.com/channel/0029Vb8D9V15K3zSnlJJrj1o";
const SPLASH_MESSAGES = ["Building your JUPEB plan…","Calculating your score position…","Finding your score blockers…","Mapping your subject gaps…","Your plan is almost ready…"];

const SUBJECT_META = {
  "Physics":             { icon:"PHY", color:"#6BAA8A" },
  "Chemistry":           { icon:"CHM", color:"#B8973E" },
  "Biology":             { icon:"BIO", color:"#4ade80" },
  "Mathematics":         { icon:"MAT", color:"#60a5fa" },
  "Economics":           { icon:"ECO", color:"#f97316" },
  "Government":          { icon:"GOV", color:"#a78bfa" },
  "Accounting":          { icon:"ACC", color:"#34d399" },
  "Business Studies":    { icon:"BST", color:"#fb923c" },
  "CRS":                 { icon:"CRS", color:"#f472b6" },
  "Geography":           { icon:"GEO", color:"#38bdf8" },
  "Agricultural Science":{ icon:"AGS", color:"#86efac" },
  "Literature in English":{ icon:"LIT", color:"#fbbf24" },
  // ── Languages & Arts ──────────────────────────────────
  "History":                 { icon:"HIS", color:"#ef4444" },
  "French":                  { icon:"FRN", color:"#3b82f6" },
  "Islamic Religious Studies":{ icon:"IRS", color:"#10b981" },
  "Music":                   { icon:"MUS", color:"#8b5cf6" },
  "Visual Arts":             { icon:"VAR", color:"#f59e0b" },
  "Yoruba":                  { icon:"YOR", color:"#ec4899" },
  "Igbo":                    { icon:"IGB", color:"#06b6d4" },
};

// ─── USER CACHE — instant loading (0ms for returning users) ──────────────────
const USER_CACHE_KEY="cq_user_v1";
const UserCache={
  get(){try{const r=localStorage.getItem(USER_CACHE_KEY);return r?JSON.parse(r):null;}catch{return null;}},
  set(d){try{localStorage.setItem(USER_CACHE_KEY,JSON.stringify(d));}catch{}},
  clear(){try{localStorage.removeItem(USER_CACHE_KEY);}catch{}}
};

// ─── JUPEB 001-004 SYLLABUS (official course units + keyword matchers) ────────
const JUPEB_COURSES={
  "Physics":[
    {code:"PHY 001",name:"Mechanics & Properties of Matter",desc:"Mechanics · Elasticity · Fluid Mechanics · SHM",keywords:["newton's law","newton law of motion","free body diagram","newton first law","newton second law","newton third law","linear momentum","conservation of momentum","impulse","elastic collision","inelastic collision","projectile motion","circular motion","centripetal","centrifugal","simple harmonic motion","hooke's law","young's modulus","bulk modulus","shear modulus","stress and strain","elastic limit","archimedes principle","bernoulli","stoke's law","terminal velocity","surface tension","capillarity","fluid mechanics","upthrust","buoyancy","viscosity","pressure in fluid","pascal","atmospheric pressure","gravitational field","escape velocity","kepler","satellite","work energy theorem","conservation of energy","power in physics","mechanical energy"]},
    {code:"PHY 002",name:"Heat, Waves & Optics",desc:"Temperature · Heat Transfer · Gas Laws · Thermodynamics",keywords:["temperature","heat","thermal","conduction","convection","radiation","gas law","thermodynamics","calorimetry","specific heat","latent heat","expansion","thermometer","boyle","charles","pressure law","ideal gas","vapour","humidity","evaporation","entropy","absolute temperature","kelvin"]},
    {code:"PHY 003",name:"Electricity & Magnetism",desc:"Light · Reflection · Refraction · Lenses · EM Spectrum",keywords:["light","optics","reflection","refraction","lens","mirror","prism","dispersion","diffraction","interference","polarisation","polarization","total internal reflection","snell","electromagnetic","spectrum","colour","color","eye","microscope","telescope","camera","photoelectric","laser","fibre","fiber","wave optics","young","optical"]},
    {code:"PHY 004",name:"Modern Physics",desc:"Circuits · Magnetism · Nuclear · Electronics",keywords:["electric","magnet","circuit","current","resistance","capacitor","induction","electron","radioactiv","nuclear","semiconductor","transistor","alternating","transformer","quantum","atomic","x-ray","solid state","digital","cathode","ohm","coulomb","potential","charge","field","motor","generator","faraday","lenz","diode","rectifier","modern physics"]},
  ],
  "Chemistry":[
    {code:"CHM 001",name:"General & Physical Chemistry",desc:"Atomic Structure · Bonding · Gas Laws · Stoichiometry",keywords:["atomic structure","chemical bond","ionic bond","electronic configuration","gas law","solution","concentration","stoichiometry","empirical formula","kinetic theory","intermolecular","hybridis","molecular geometry","precipitation","solubility","mole","isotope","relative","chemical formula","chemical equation","ionic equation","balanced equation","dalton","bohr","avogadro","measurement","allotropy","phase","thermochem","colligative"]},
    {code:"CHM 002",name:"Physical & Analytical Chemistry",desc:"Electrochemistry · Kinetics · Thermodynamics · Radioactivity",keywords:["electrochemistry","electrolysis","chemical kinetics","radioactivity","nuclear chem","thermodynamics","acid-base","buffer","catalysis","reaction mechanism","electronic effect","redox","rate","ph","activation energy","enthalpy","entropy","gibbs","electrode","cell potential","faraday","half-cell","corrosion","oxidation","reduction","order of reaction","analytical"]},
    {code:"CHM 003",name:"Inorganic Chemistry",desc:"Periodic Table · Groups · Transition Metals · Industrial",keywords:["periodic table","periodic trend","group 1","group 2","group 13","group 16","halogen","transition metal","coordination","nitrogen chemistry","oxides of nitrogen","industrial chem","inorganic","period 3","complex","ligand","alkali metal","alkaline earth","noble gas","chlorine","sulphur","phosphorus","iron","copper","zinc","chromium","extraction","metallurgy","water chem"]},
    {code:"CHM 004",name:"Organic Chemistry",desc:"Hydrocarbons · Functional Groups · Reactions · Polymers",keywords:["organic","hydrocarbon","alkene","alkane","alkyne","amine","amino acid","isomerism","polymer","carbohydrate","protein","biochem","biotechnology","iupac","nomenclature","aromatic","benzene","functional group","alcohol","aldehyde","ketone","carboxylic","ester","amide","addition","substitution","elimination","condensation","saponification","grignard","nucleophile"]},
  ],
  "Biology":[
    {code:"BIO 001",name:"Cell Biology & Genetics",desc:"Cell Biology · Genetics · Evolution · Ecology · Classification",keywords:["cell biology","cell division","cell organelle","cell metabolism","cell respiration","cell transport","genetics","evolution","ecology","classification","taxonomy","molecular biology","cytology","microscopy","immunology","homeostasis","dna","heredity","mendel","mitosis","meiosis","chromosome","mutation","natural selection","food chain","food web","ecosystem","habitat","niche","population","community","biosphere","biochem"]},
    {code:"BIO 002",name:"Basic Botany",desc:"Plant Morphology · Physiology · Photosynthesis · Reproduction",keywords:["plant biology","plant physiology","plant anatomy","plant classification","plant kingdom","plant morphology","plant reproduction","plant tissue","photosynthesis","botany","transport in plant","conservation","carbon cycle","transpiration","economic botany","xylem","phloem","root","stem","leaf","flower","seed","fruit","germination","tropism","auxin","stomata","chloroplast"]},
    {code:"BIO 003",name:"Microbiology & Disease",desc:"Bacteria · Viruses · Fungi · Immunity · Disease",keywords:["microbiology","virology","fungi","parasitology","disease","bacteria","virus","immunity","antibiotic","pathogen","microorganism","biotechnology","fermentation","infection","vaccine","antibody","antigen","malaria","typhoid","cholera","tuberculosis","hiv","aids","protozoa","plasmid","culture","agar","epidemiology"]},
    {code:"BIO 004",name:"Zoology & Human Physiology",desc:"Animal Taxonomy · Tissues · Physiology · Reproduction",keywords:["zoology","animal kingdom","animal tissue","anatomy","embryology","entomology","insect","circulatory","excretion","excretory","reproduction","reproductive","respiration","sensory","skeletal","neurophysiology","endocrinology","human biology","nutrition","physiology","osmosis","digestion","vertebrate","invertebrate","mammal","heart","lung","kidney","liver","muscle","blood","nervous system","hormone","reflex"]},
  ],
  "Mathematics":[
    {code:"MAT 001",name:"Advanced Pure Mathematics",desc:"Algebra · Sets · Complex Numbers · Trigonometry · Coordinate Geometry",keywords:["real numbers","integers","rational","irrational","mathematical induction","arithmetic progression","geometric progression","binary operations","set theory","subset","union","intersection","complement","venn diagram","mapping","domain","range","inverse function","composite function","quadratic","discriminant","polynomial","factor theorem","remainder theorem","partial fraction","binomial theorem","pascal triangle","logarithm","indices","matrices","determinant","inequality","absolute value","complex number","argand","de moivre","trigonometry","circular measure","radian","arc length","sector","trigonometric function","trig identities","coordinate geometry","straight line","gradient","midpoint","circle","parabola","ellipse","hyperbola","conic"]},
    {code:"MAT 002",name:"Calculus",desc:"Differentiation · Integration · Differential Equations · Exponential",keywords:["calculus","differentiation","first principle","chain rule","product rule","quotient rule","implicit differentiation","parametric","higher order derivative","tangent and normal","maximum","minimum","rate of change","curve sketching","maclaurin","taylor series","exponential function","logarithmic function","integration","standard integral","definite integral","substitution method","integration by parts","trapezoidal rule","simpson rule","area under curve","volume of revolution","differential equation","homogeneous equation","exponential growth","exponential decay","limit","continuity","derivative"]},
    {code:"MAT 003",name:"Applied Mathematics",desc:"Vectors · Kinematics · Newtonian Mechanics · Statics · Moment of Inertia",keywords:["vector algebra","dot product","cross product","scalar product","vector product","position vector","unit vector","vector equation of line","vector equation of plane","three dimensional vector","rectangular unit vector","i j k","linear dependence of vectors","collinearity","perpendicularity of vectors","velocity-time graph","displacement-time graph","rectilinear motion","uniform acceleration","motion under gravity","relative velocity","relative path","connected particles","atwood machine","inclined plane","moment of inertia","radius of gyration","parallel axis theorem","perpendicular axis theorem","kinetic energy of rotation","parallel forces","couple","moment of force","smooth body","centre of gravity","rigid body","forces equilibrium in mathematics","statics in mathematics","applied mathematics"]},
    {code:"MAT 004",name:"Statistics",desc:"Data · Probability · Random Variables · Normal Distribution · Regression",keywords:["statistics","population","sample","random variable","histogram","bar chart","pie chart","ogive","frequency polygon","mean","median","mode","central tendency","mean deviation","standard deviation","variance","skewness","kurtosis","permutation","combination","probability","probability density function","probability distribution","discrete random variable","expectation","bernoulli","binomial distribution","geometric distribution","poisson distribution","normal distribution","standard normal table","hypothesis test","significance test","chi-square test","goodness of fit","contingency table","t-distribution","student t","regression","correlation","simple linear regression","sampling technique","finite sampling","infinite sampling"]},
  ],
  "Economics":[
    {code:"ECN 001",name:"Principles of Economics I",desc:"Demand · Supply · Market Structures · Consumer Theory",keywords:["demand","supply","microeconomics","market structure","consumer theory","elasticity","monopoly","perfect competition","factor market","production theory","market equilibrium","market failure","price","firm","oligopoly","cost","revenue","utility","indifference","budget","externality","public good","allocative","producer","consumer","surplus","isoquant","isocost","profit maximization","price discrimination"]},
    {code:"ECN 002",name:"Principles of Economics II",desc:"National Income · Money · Inflation · Fiscal Policy",keywords:["macroeconomics","national income","money","banking","inflation","unemployment","fiscal policy","monetary policy","aggregate","business cycle","multiplier","keynesian","gdp","gnp","circular flow","consumption","investment","saving","tax","government spending","deflation","money supply","money demand","money creation","recession","boom"]},
    {code:"ECN 003",name:"Applied Economics I",desc:"Development · Growth · Labour · Nigerian Economy",keywords:["development economics","economic development","economic growth","labour economics","population","west african","nigerian","agricultural economics","factor income","migration","income distribution","poverty","underdevelopment","production sector","public finance","public corporation","economic history","opportunity cost","production possibility","nigeria economy","economic planning"]},
    {code:"ECN 004",name:"Applied Economics II",desc:"International Trade · Balance of Payments · Exchange Rates",keywords:["international","balance of payments","exchange rate","globalisation","globalization","international trade","trade theory","integration","international finance","comparative advantage","trade policy","foreign","import","export","ecowas","wto","imf","world bank","tariff","quota","terms of trade","current account","capital account"]},
  ],
  "Government":[
    {code:"GOV 001",name:"Political Concepts & Theory",desc:"Democracy · Sovereignty · Federalism · Rights",keywords:["political concept","democracy","sovereignty","constitutionalism","political ideology","political theory","forms of government","types of government","power and authority","rule of law","separation of power","federalism","confederation","political culture","political socialisation","pressure group","political party","franchise","voting","electoral","citizenship","rights","freedom"]},
    {code:"GOV 002",name:"Nigerian Government & Politics",desc:"Nigerian Constitution · History · Institutions",keywords:["nigerian","nigeria","colonial administration","colonial history","nigerian constitution","nigerian government","nigerian political","nigerian military","nigerian nationalism","nigerian foreign","electoral commission","local government","military rule","nationalism","biafra","civil war","second republic","fourth republic","inec","npc","ncnc","ag","colonial policies"]},
    {code:"GOV 003",name:"Comparative Government",desc:"Legislature · Executive · Judiciary · Electoral Systems",keywords:["legislature","executive","government institution","government system","electoral system","political participation","public administration","comparative","the state","features of a state","nation and state","systems of government","parliament","presidential","cabinet","prime minister","president","judiciary","court","constitution comparative"]},
    {code:"GOV 004",name:"International Relations & Africa",desc:"African Politics · International Organisations · Foreign Policy",keywords:["international relation","international organisation","foreign policy","pan-africanism","african government","african history","apartheid","african politics","post-colonial africa","pre-colonial africa","regional organization","west african history","world history","democracy in africa","african union","ecowas","un","nato","commonwealth","cold war","non-aligned","diplomacy"]},
  ],
  "Accounting":[
    {code:"ACC 001",name:"Financial Accounting Principles",desc:"Bookkeeping · Double Entry · Trial Balance · Final Accounts",keywords:["bookkeeping","double entry","trial balance","books of account","accounting concepts","accounting standards","financial statements","bank reconciliation","petty cash","cash book","error correction","bad debts","depreciation","asset disposal","asset classification","trading account","control accounts","debtors control","incomplete records","accrual","ledger","journal","purchases","sales","financial reporting"]},
    {code:"ACC 002",name:"Company & Business Accounting",desc:"Partnership · Company Accounts · Share Capital",keywords:["partnership","share capital","company","debentures","reserves","non-profit","financial ratios","ias standard","manufacturing account","inventory","ifrs","corporate governance","company law","goodwill","admission","retirement","dissolution","revaluation","amalgamation","merger","holding company","subsidiary","consolidated","stewardship","audit","company type"]},
    {code:"ACC 003",name:"Management Accounting",desc:"Costing · Budgeting · Standard Costing · Break-Even",keywords:["management accounting","cost accounting","costing","budgeting","standard costing","variance","decision","marginal costing","break-even","overhead","labour costing","materials","process costing","production budget","cost behaviour","cost classification","cost separation","overhead absorption","overhead apportionment","investment appraisal","cash budget","cash flow","contribution"]},
    {code:"ACC 004",name:"Taxation & Auditing",desc:"Nigerian Tax System · Auditing · Forensic Accounting",keywords:["taxation","tax","audit","forensic","government audit","professional ethics","engagement letter","types of audit","internal audit","internal control","company audit","nigerian tax","personal income tax","companies income tax","education tax","tax administration","tax computation","types of tax","paye","vat","withholding"]},
  ],
  "Business Studies":[
    {code:"BUS 001",name:"Business & Its Environment",desc:"Business Types · Ownership · Corporate Structure",keywords:["business environment","business organisation","business ownership","business structure","business classification","business registration","company type","partnership deed","sole proprietorship","franchise","business purpose","business sector","stakeholder","corporate culture","organizational","csr","sustainability","mission","vision","swot","business ethics","cooperative"]},
    {code:"BUS 002",name:"Finance & Accounting",desc:"Marketing Mix · Sales · Distribution · Communication",keywords:["marketing","market segmentation","marketing mix","marketing research","marketing strategy","product strategy","distribution","sales","communication","business communication","competitive","international business","trade finance","branding","pricing","promotion","advertising","public relations","channels","retail","wholesale","e-commerce"]},
    {code:"BUS 003",name:"Management I",desc:"Management Functions · Leadership · Motivation · HRM",keywords:["management","leadership","motivation","human resource","delegation","organisational design","planning","management functions","management level","management principle","management role","management skill","management theory","teamwork","motivation theory","theory x","health and safety","employment rights","productivity","strategic","recruitment","selection","training","appraisal","dismissal"]},
    {code:"BUS 004",name:"Management II",desc:"Sources of Finance · Financial Analysis · Budgeting",keywords:["business finance","sources of finance","financial management","financial institutions","financial markets","financial statements","financial ratios","financial analysis","cash flow","working capital","capital market","investment appraisal","break-even","budgeting","depreciation","inventory","balance sheet","trial balance","double entry","drawings","fixed asset","economic order"]},
  ],
  "CRS":[
    {code:"CRS 001",name:"Old Testament",desc:"Creation · Patriarchs · Kings · Prophets · Exile",keywords:["old testament","creation","genesis","exodus","patriarchs","moses","israelite","kings","prophets","exile","babylonian captivity","post-exilic","samuel","solomon","david","divided kingdom","joshua","judges","psalms","proverbs","isaiah","jeremiah","ezekiel","amos","hosea","covenant","tabernacle","ten commandments","african traditional religion"]},
    {code:"CRS 002",name:"New Testament",desc:"Life of Jesus · Early Church · Letters of Paul",keywords:["new testament","acts of apostles","gospel","jesus","miracles","transfiguration","death and resurrection","ministry","teachings","sermon on the mount","paul","epistles","romans","corinthians","galatians","ephesians","early church","pentecost","apostles","resurrection","crucifixion","baptism","eucharist","synoptic"]},
    {code:"CRS 003",name:"Christianity in Africa & Nigeria",desc:"Church History · Missions · Christianity in West Africa",keywords:["christianity in africa","christianity in nigeria","christianity in west africa","african christianity","african independent churches","church history","christian missions","history of christianity","niger mission","anglican church","baptist church","methodist church","pentecostalism","missiology","colonialism church","missionary","education missions","medical missions"]},
    {code:"CRS 004",name:"Christian Ethics & Theology",desc:"Ethics · Family · Society · World Religions",keywords:["christian ethics","ethics","religious ethics","social ethics","christian education","family studies","inter-religious dialogue","world religions","contemporary issues","conflict resolution","human values","religion and society","biblical analysis","biblical criticism","biblical genres","biblical inspiration","biblical literature","stewardship","justice","peace","love","sin","grace","salvation"]},
  ],
  "Geography":[
    {code:"GEO 001",name:"Physical Geography",desc:"Landforms · Atmosphere · Climate · Rivers · Coasts",keywords:["physical geography","geomorphology","atmosphere","climatology","climate","weather","hydrology","rivers","river processes","drainage patterns","coastal processes","glaciation","karst","plate tectonics","volcanoes","rock types","seismology","earth movements","mass movement","weathering","erosion","fluvial","precipitation","atmospheric temperature","climatic regions","soils","wind","desert","tropical"]},
    {code:"GEO 002",name:"Human Geography",desc:"Population · Settlement · Agriculture · Industry",keywords:["human geography","population","settlement geography","urbanisation","urbanization","urban problems","agriculture","agricultural geography","economic activities","economic sectors","economic geography","industrial location","transport","transport geography","regional development","tourism","cultural geography","natural resources","energy resources","mining","industry","manufacturing"]},
    {code:"GEO 003",name:"Regional Geography",desc:"West Africa · Africa · Nigeria · International Trade",keywords:["regional geography","west africa","west african","african geography","african resources","african rivers","nigerian geography","nigerian economy","north american","regional organization","international trade","trade routes","geographic theories","political geography","global","world geography","nigeria","river niger","river benue","guinea","sahel","savanna","rainforest","sahara"]},
    {code:"GEO 004",name:"Maps, Statistics & Remote Sensing",desc:"Map Reading · Cartography · GIS · Meteorology",keywords:["map reading","cartography","map scale","map types","statistical diagrams","remote sensing","gis","aerial photo","geographic coordinates","astronomy","solar system","time zones","meteorology","meteorological instruments","weather maps","contour","grid reference","bearing","cross section","relief","topographic"]},
  ],
  "Agricultural Science":[
    {code:"AGS 001",name:"Soil Science & Farm Management",desc:"Soil Science · Farm Tools · Land Tenure · Ecology",keywords:["soil science","soil biology","soil chemistry","soil composition","soil conservation","soil management","land tenure","land use","farm tools","agricultural tools","ecology","biodiversity","desertification","environmental science","importance of agriculture","agroclimatology","wildlife","soil profile","soil texture","soil structure","leaching","erosion control","irrigation","drainage"]},
    {code:"AGS 002",name:"Crop Production",desc:"Crop Science · Cultivation · Pest Control · Post-Harvest",keywords:["crop production","crop science","crop diseases","crop pests","crop physiology","crop processing","crop protection","weed science","weed control","plant nutrition","plant physiology","plant propagation","vegetative propagation","horticultural crop","post-harvest","food technology","fertilizer","farming","tillage","planting","harvesting","storage","processing","pest","insect pest","fungal disease"]},
    {code:"AGS 003",name:"Animal Production",desc:"Livestock · Poultry · Fisheries · Animal Nutrition",keywords:["animal production","animal husbandry","animal nutrition","animal health","animal management","animal reproduction","animal genetics","animal breeds","animal feeds","animal science","poultry production","aquaculture","fisheries","livestock","parasite","veterinary","artificial insemination","feed classification","feed preservation","pasture","cattle","goat","sheep","pig","rabbit","broiler","layer","tilapia"]},
    {code:"AGS 004",name:"Agricultural Economics & Extension",desc:"Farm Economics · Marketing · Machinery · Forestry",keywords:["agricultural economics","farm economics","farm management","farm accounting","farm records","farm mechanisation","farm machinery","agricultural marketing","agricultural extension","market structure","production economics","reforestation","agro-forestry","forestry","forest management","cooperative","land reform","agribusiness","value chain","farm income","rural development"]},
  ],
  "Literature in English":[
    {code:"LIT 001",name:"Drama",desc:"Dramatic Conventions · Greek · African · Tragedy · Comedy",keywords:["drama","dramatic","drama elements","drama history","drama techniques","drama theory","greek drama","greek tragedy","tragedy","comedy","othello","wole soyinka","death and the king","lion and the jewel","oedipus","hamlet","macbeth","stage","playwright","acts","scenes","dialogue","soliloquy","dramatic irony","conflict","denouement","catharsis","chorus"]},
    {code:"LIT 002",name:"Poetry",desc:"African Poetry · European Poetry · Poetic Devices · Oral Poetry",keywords:["poetry","poem","poetic","poetry analysis","poetry forms","poetry genres","poetry structure","transferred epithet","oral poetry","african poetry","european poetry","sonnet","ballad","elegy","ode","imagery","metaphor","simile","alliteration","assonance","rhyme","rhythm","stanza","verse","persona","tone","mood","diction","symbolism"]},
    {code:"LIT 003",name:"Prose Fiction",desc:"African Novel · European Novel · Short Story · Narrative",keywords:["novel","novel types","prose genres","prose techniques","narrative technique","setting","african literature","folklore","chinua achebe","things fall apart","ngugi","weep not child","short story","narrative","plot","character","characterisation","theme","symbol","satire","irony","omniscient","first person","third person","flashback","foreshadowing"]},
    {code:"LIT 004",name:"Literary Theory & Criticism",desc:"Literary Devices · Genres · Criticism · Style · Context",keywords:["literary analysis","literary criticism","literary devices","literary elements","literary genres","literary history","literary periods","literary style","literary terms","literary theory","history of literature","characterization","plot structure","formalism","new criticism","postcolonial","feminist","marxist","deconstruction","intertextuality","canon","context","biography"]},
  ],
};

// ─── SHORT-KEYWORD ALIASES ────────────────────────────────────────────────────
// The main JUPEB_COURSES keywords use long phrases (e.g. "vector algebra") which
// fail to match short Gemini-generated topic names (e.g. "Vectors", "Kinematics").
// These aliases cover single-word and short-phrase topic names for every unit.
// Matching is BIDIRECTIONAL for aliases: topic.includes(alias) OR alias.includes(topic)
const COURSE_ALIASES={
  "Physics":{
    "PHY 001":["mechanics","elasticity","gravitation","oscillation","projectile","pendulum","spring","buoyancy","density","fluid","gravity","momentum","impulse","collision","friction","shm","centripetal","escape velocity","satellite","hooke","archimedes","surface tension","viscosity","capillarity","newton","motion","inertia","equilibrium of forces","work energy","mechanical energy","power"],
    "PHY 002":["wave","waves","heat","calorimetry","latent heat","specific heat","expansion","evaporation","gas","radiation","conduction","convection","thermometer","entropy","kelvin","temperature","humidity","vapour","ideal gas","boyle","charles"],
    "PHY 003":["optics","light","reflection","refraction","lens","mirror","prism","diffraction","interference","polarisation","polarization","spectrum","colour","color","microscope","telescope","photoelectric","laser","fibre","fiber","snell","dispersion"],
    "PHY 004":["electricity","circuit","current","resistance","capacitor","induction","radioactivity","nuclear","semiconductor","transistor","alternating current","transformer","atomic","x-ray","diode","rectifier","logic gate","digital electronics","electrostatics","magnetism","magnet","cathode","ohm","coulomb","quantum","faraday","lenz"],
  },
  "Mathematics":{
    "MAT 001":["algebra","sets","trigonometry","coordinate geometry","logarithm","indices","matrices","binomial","quadratic","polynomial","series","sequence","functions","inequalities","venn diagram","complex numbers","modulus","surds","permutation","combination","arithmetic progression","geometric progression","conic section","ellipse","hyperbola","parabola","determinant","inverse function","composite function","mapping","partial fraction","remainder theorem","factor theorem","mathematical induction"],
    "MAT 002":["calculus","differentiation","integration","differential equations","limits","rate of change","gradient","tangent","stationary point","inflexion","exponential","logarithmic function","maclaurin","taylor","area under curve","volume of revolution","first principle","chain rule","product rule","quotient rule","implicit differentiation","parametric"],
    "MAT 003":["vector","vectors","kinematics","kinematic","statics","static","dynamics","dynamic","moment","moments","couple","couples","friction","projectile","velocity","speed","acceleration","displacement","distance","force","forces","resultant","component","resolution","inclined","tension","newton","smooth surface","rough surface","coplanar","lami","atwood","pulley","rigid body","gravity","momentum","collision","relative velocity","connected particles","equilibrium","centre of gravity","angular velocity","angular acceleration","rectilinear","uniform acceleration","motion under gravity","kinetic energy of rotation","applied mathematics"],
    "MAT 004":["statistics","probability","distribution","mean","median","mode","variance","standard deviation","regression","correlation","hypothesis","normal distribution","frequency","histogram","ogive","skewness","binomial distribution","poisson distribution","chi-square","t-distribution","sampling","random variable","expectation","data","pie chart","bar chart","scatter diagram","standard normal","significance","contingency"],
  },
  "Chemistry":{
    "CHM 001":["atomic","bonding","stoichiometry","mole concept","isotope","gas laws","solution","concentration","covalent bond","metallic bond","hybridization","molecular geometry","colligative properties","allotropy","intermolecular forces","empirical formula","molecular formula","avogadro","dalton","bohr","kinetic theory","phase equilibrium"],
    "CHM 002":["electrochemistry","electrolysis","kinetics","radioactivity","thermochemistry","acid base","buffer solution","catalyst","reaction rate","enthalpy","entropy","gibbs energy","redox","corrosion","electrode potential","activation energy","half-cell","order of reaction","analytical chemistry"],
    "CHM 003":["periodic table","periodicity","group","halogens","transition metals","nitrogen chemistry","industrial chemistry","extraction","metallurgy","coordination compound","inorganic","alkali metals","noble gas","chlorine","sulphur","phosphorus","iron","copper","zinc","chromium"],
    "CHM 004":["organic chemistry","hydrocarbon","alkanes","alkenes","alkynes","isomerism","polymers","carbohydrates","proteins","alcohol","aldehyde","ketone","carboxylic acid","ester","amine","amino acid","aromatic","benzene","nomenclature","reaction mechanism","addition reaction","substitution reaction","elimination reaction","saponification","nucleophile"],
  },
  "Biology":{
    "BIO 001":["cell","genetics","evolution","ecology","classification","dna","chromosome","heredity","natural selection","food web","food chain","ecosystem","population","community","taxonomy","mutation","mitosis","meiosis","mendel","immunology","homeostasis","molecular biology","cytology","cell division","cell organelle","cell transport"],
    "BIO 002":["plant","photosynthesis","transpiration","germination","flower","root","stem","leaf","seed","fruit","xylem","phloem","auxin","botany","stomata","chloroplast","tropism","plant reproduction","plant tissue","plant physiology","pollination","conservation","carbon cycle"],
    "BIO 003":["bacteria","virus","fungi","disease","immunity","antibiotic","malaria","typhoid","cholera","tuberculosis","hiv","vaccine","pathogen","microorganism","fermentation","infection","protozoa","biotechnology","epidemiology","plasmid","culture medium"],
    "BIO 004":["animal","digestion","respiration","circulation","excretion","reproduction","nervous system","hormone","kidney","liver","blood","heart","lung","muscle","bone","reflex","vertebrate","invertebrate","mammal","insect","zoology","anatomy","physiology","endocrine","sensory organ","circulatory","excretory","reproductive"],
  },
  "Economics":{
    "ECN 001":["demand","supply","elasticity","market structure","consumer theory","utility","monopoly","competition","price","cost","revenue","production","indifference curve","budget line","externality","surplus","isoquant","oligopoly","factor market","allocative efficiency"],
    "ECN 002":["national income","money","banking","inflation","unemployment","fiscal policy","monetary policy","gdp","gnp","aggregate demand","multiplier","keynesian","recession","deflation","savings","consumption","circular flow","money supply","money creation"],
    "ECN 003":["economic development","economic growth","labour","population","nigeria","agriculture","poverty","income distribution","economic planning","migration","public finance","west africa","underdevelopment","production sector"],
    "ECN 004":["international trade","balance of payments","exchange rate","globalization","imports","exports","ecowas","tariff","quota","comparative advantage","terms of trade","wto","imf","world bank","foreign exchange","trade policy","current account","capital account"],
  },
  "Government":{
    "GOV 001":["democracy","sovereignty","federalism","constitution","political ideology","rights","freedom","franchise","voting","electoral","citizenship","rule of law","separation of powers","pressure groups","political party","confederation","legitimacy","authority","colonialism"],
    "GOV 002":["nigeria","colonial administration","independence","military rule","coup","nigerian constitution","republic","elections","political parties","inec","biafra","nationalism","ncnc","second republic","fourth republic","colonial period","nigerian history"],
    "GOV 003":["legislature","executive","judiciary","parliament","presidential system","cabinet","prime minister","court","electoral system","public administration","comparative government","state","systems of government","voting system","separation of power"],
    "GOV 004":["international relations","foreign policy","diplomacy","united nations","african union","ecowas","nato","cold war","non-aligned movement","pan-africanism","apartheid","post-colonial africa","regional organization","international organisation"],
  },
  "Accounting":{
    "ACC 001":["bookkeeping","trial balance","ledger","journal","balance sheet","income statement","profit and loss","depreciation","bad debts","bank reconciliation","control accounts","accruals","prepayments","error correction","petty cash","trading account","double entry","incomplete records","debtors","creditors"],
    "ACC 002":["partnership","company accounts","share capital","debentures","goodwill","dissolution","revaluation","amalgamation","holding company","subsidiary","reserves","ias","ifrs","admission of partner","retirement of partner","non-profit"],
    "ACC 003":["costing","budgeting","variance analysis","marginal costing","break-even","overhead absorption","standard costing","cost behaviour","process costing","contribution","decision making","cash budget","management accounting"],
    "ACC 004":["taxation","tax computation","audit","vat","paye","personal income tax","companies income tax","internal control","forensic accounting","nigerian tax","education tax","withholding tax","engagement letter","types of audit"],
  },
  "Business Studies":{
    "BUS 001":["sole proprietorship","partnership","limited company","cooperative","franchise","stakeholder","corporate governance","business environment","business ownership","registration","organisational structure","csr","business types","mission","vision","swot"],
    "BUS 002":["marketing","market segmentation","distribution channels","promotion","advertising","pricing strategy","branding","personal selling","market research","business communication","retail","wholesale","e-commerce","marketing mix"],
    "BUS 003":["management","leadership","motivation","human resource management","planning","organising","directing","controlling","delegation","teamwork","recruitment","selection","training","performance appraisal","management functions","health and safety"],
    "BUS 004":["business finance","sources of finance","investment appraisal","budgeting","cash flow","financial management","working capital","break-even","depreciation","ratio analysis","capital market","financial statements","financial ratios"],
  },
  "CRS":{
    "CRS 001":["old testament","genesis","exodus","creation","moses","abraham","joseph","solomon","david","israelites","covenant","prophet","divided kingdom","judges","psalms","proverbs","isaiah","jeremiah","ezekiel","amos","hosea","ten commandments","passover","tabernacle","exile"],
    "CRS 002":["new testament","jesus","paul","gospel","early church","baptism","resurrection","crucifixion","apostle","epistles","acts of apostles","peter","pentecost","ministry","miracles","sermon on the mount","death and resurrection","synoptic","eucharist"],
    "CRS 003":["missionary","colonialism","church history","christianity in nigeria","christianity in africa","mission","educational mission","medical mission","protestant","catholic","methodist","baptist","anglican","niger mission","colonial church"],
    "CRS 004":["christian ethics","family","marriage","society","inter-religious","world religions","justice","peace","salvation","sin","grace","stewardship","love","social ethics","religious ethics","contemporary issues"],
  },
  "Geography":{
    "GEO 001":["landform","atmosphere","climate","weather","river","coastal","glacier","volcanic","earthquake","erosion","weathering","desert","tropical","geomorphology","plate tectonics","hydrology","drainage","soils","wind","karst","mass movement"],
    "GEO 002":["population","settlement","urbanisation","agriculture","industry","transport","tourism","resources","migration","economic activities","industrial location","manufacturing","human geography","regional development","natural resources","energy resources"],
  },
  "Agricultural Science":{
    "AGS 001":["crop production","cultivation","tillage","soil","fertilizer","crop","planting","harvesting","weed","pest","disease control","irrigation","drainage","farm tools","farm machinery","land preparation","seeds","seedlings","nursery"],
    "AGS 002":["animal production","livestock","poultry","cattle","goat","sheep","pig","fish farming","aquaculture","animal nutrition","animal health","veterinary","breeding","reproduction in animals","feeding","housing of animals"],
    "AGS 003":["agricultural economics","farm management","marketing","agricultural finance","cooperative","extension","credit","farm records","agribusiness","land tenure","agricultural policy","nigerian agriculture","food security"],
    "AGS 004":["food science","food processing","food preservation","storage","post harvest","nutrition","food quality","food safety","biotechnology in agriculture","genetics in agriculture","crop improvement","plant breeding","animal genetics"],
  },
  "Literature in English":{
    "LIT 001":["drama","play","theatre","tragedy","comedy","playwright","stage","soliloquy","dramatic irony","conflict","catharsis","greek drama","african drama","wole soyinka","othello","hamlet","macbeth","denouement","acts","scenes","dialogue"],
    "LIT 002":["poetry","poem","poetic","sonnet","ballad","elegy","ode","imagery","metaphor","simile","alliteration","assonance","rhyme","rhythm","stanza","verse","persona","tone","mood","diction","symbolism","oral poetry","african poetry"],
    "LIT 003":["novel","prose","narrative","setting","character","characterisation","theme","plot","short story","african literature","folklore","chinua achebe","things fall apart","ngugi","satire","irony","omniscient","first person","third person","flashback","foreshadowing"],
    "LIT 004":["literary analysis","literary criticism","literary devices","literary elements","literary genres","literary theory","formalism","postcolonial","feminist","marxist","deconstruction","intertextuality","history of literature","context","biography","canon"],
  },
  // ── LANGUAGES & ARTS ─────────────────────────────────────────────────────────
  "History":[
    {code:"HST 001",name:"African History I",desc:"Ancient Empires · East Africa · Trans-Atlantic Slave Trade",keywords:["ghana empire","mali empire","kanem bornu","timbuktu","sundiata","mansa musa","swahili","buganda","east africa","arab trade","benin empire","nok","ife","slave trade","colonial administration","indirect rule","assimilation","apartheid","berlin conference","scramble","partition","indirect rule","warrant chief","assimilation","paternalism","mau mau","african nationalism","boer","kenya","south africa","oau","african union","goree","senegal","communes","ngazargamu","almoravids","koumbi saleh","ife art","Kanem-Bornu","east african coast","mummification","hieroglyphic","hammurabi","pyramids"]},
    {code:"HST 002",name:"World History I",desc:"Ancient Civilisations · European Exploration · American History",keywords:["mesopotamia","egypt","babylon","hammurabi","sumer","cuneiform","pyramid","mummification","athens","rome","renaissance","exploration","columbus","vasco da gama","american revolution","american civil war","boston","declaration of independence","industrial revolution","steam engine","factory","french revolution","robespierre","bastille","napoleon","vienna congress","nationalism","prince henry","cape of good hope","dutch east india","thirty years war","westphalia","sugar act","quartering act","spinning jenny","cottage industry"]},
    {code:"HST 003",name:"African History II",desc:"Colonialism · Nationalism · Post-Independence Africa",keywords:["colonial policy","indirect rule failure","eastern nigeria","western nigeria","northern nigeria","warrant chief system","assimilation senegal","blaise diagne","mau-mau","kenya nationalist","kwame nkrumah","pan africanism","jomo kenyatta","mandela","apartheid","south african history","independence","decolonisation","african union","british east africa","direct rule","kenyatta","afrikaner","afrikaans","boer war","sayyid said","zanzibar","omani","mfecane","zulu","basutoland","lesotho","buganda","katikkiro","bulala","sokoto","dan fodio"]},
    {code:"HST 004",name:"World History II",desc:"World Wars · League of Nations · French Revolution · Industrial Revolution",keywords:["world war 1","world war i","wwi","world war 2","wwii","treaty of versailles","league of nations","cold war","united nations","nato","korean war","european union","thirty years war","westphalia","industrial revolution europe","russian revolution","franco-prussian","bismarck","german unification","austrian","habsburg","concert of europe","atlantic charter","vienna congress","triple alliance","triple entente","assassination","archduke","armistice","chartist","agricultural revolution","cottage industry","spinning jenny"]},
  ],
  "French":[
    {code:"FRE 001",name:"Oral French/Phonetics I & Basic Grammar I",desc:"Phonetics · Vowels · Consonants · Basic Grammar",keywords:["phonetics","voyelle","consonne","semi-voyelle","nasale","nasal vowel","articulation","liaison","transcription","accent","pronunciation","verb conjugation","present tense","negation","possessive","gender","agreement","adjective","preposition","interrogative","imperative","infinitive","passé composé","imparfait","futur","phonème","syllabe","son phonétique","ɲ","ʃ","œ","ã","e fermé","bilabial","labiodental","partitive article","agreement adjective","subject verb"]},
    {code:"FRE 002",name:"Basic Writing/French Culture & Civilisation I",desc:"Writing · African Culture · Family · Food · Francophonie",keywords:["francophonie","francophone","african culture","family in africa","african food","festival","culture","civilization","civilisation","african meal","marriage in africa","nuclear family","extended family","essay","culture française","francophone country","africa","cameroon","ivory coast","senegal","benin","togo","mali","guinea","rfi","tv5","celine dion","onu","ecowas","cedeao","caf","francophone countries","onésime reclus","sommet francophonie","versailles","bilad","francophone africa","petite famille","grande famille","plat principal","entrée","fête","francophi","francophob"]},
    {code:"FRE 003",name:"Oral French/Phonetics II & Basic Grammar II",desc:"Advanced Grammar · Passive Voice · Conditional · Negation",keywords:["passive voice","voix passive","indirect speech","discours indirect","conditional","conditionnel","subjunctive","relative pronoun","compound tense","plus-que-parfait","passé simple","phoneme","syllable","intonation","liaison","future tense","négation","ne pas","complement","objet direct","objet indirect","pronom personnel","y en","direct object","indirect object","gérondif","participe","subordinate clause","adverb","adverbe","agreement past participle"]},
    {code:"FRE 004",name:"Basic Writing/French Culture & Civilisation II",desc:"Literature · Francophone Authors · French Society",keywords:["literature","littérature","novel","roman","playwright","dramaturge","poem","poetry","poésie","prose","theatre","théâtre","genre","author","écrivain","francophone literature","mongo beti","oyono","sembène","césaire","senghor","négritude","colonial literature","african novel","french society","paris","education system","comparison nigeria france","molière","camus","pagnol","hugo","trois prétendants","une vie de boy","miroir de la société","genres littéraires","poésie théâtre prose"]},
  ],
  "Islamic Religious Studies":[
    {code:"ISS 001",name:"History of Islam",desc:"Prophet Muhammad · Early Caliphate · Jihad in Nigeria",keywords:["prophet muhammad","jahiliyyah","hijrah","migration","makkah","madinah","battle","badr","uhud","khandaq","conquest of makkah","hudaybiyyah","abu bakr","umar","uthman","ali","umayyad","abbasid","dan fodio","sokoto caliphate","jihad nigeria","history of islam","year of sorrow","companions","cave hira","first revelation","jibril","khadijah","abu talib","fatimah","ridda wars","khawarij","year of grief","emigration to abyssinia","treaty","madinan constitution","makkah","harun rashid","uthman dan fodio","islamic history","nigeria islam","usman dan fodio","caliphate"]},
    {code:"ISS 002",name:"Tawhid & Ibadah",desc:"Faith · Worship · Pillars of Islam · Purification",keywords:["tawhid","shirk","iman","faith","articles of faith","pillars of islam","salat","prayer","zakah","zakat","sawm","fasting","ramadan","hajj","pilgrimage","ibadah","wudu","tayammum","ghusl","purification","taharah","arafah","tawaf","umrah","five pillars","oneness of allah","monotheism","nikah","marriage","divorce","iddah","kaffarah","fidyah","zakat al-fitr","obligatory prayer","friday prayer","eid prayer","khutbah","qibla","masjid","mosque","salat times","salat conditions","marriage conditions"]},
    {code:"ISS 003",name:"Qur'anic Studies",desc:"Revelation · Compilation · Tafsir · Surahs",keywords:["quran","qur'an","revelation","compilation","tafsir","surah","ayah","verse","chapter","abrogation","naskh","asbab al-nuzul","circumstances of revelation","al-fatihah","al-baqarah","al-ikhlas","al-falaq","an-nas","al-kawthar","al-asr","at-takathur","hadith qudsi","tanzil","inimitability","ijaz","preservation","hafiz","recitation","tartil","makkan surah","madinan surah","names of quran","al-dhikr","al-kitab","al-furqan","mu'awwidhatan","uthmanic compilation","zayd ibn thabit","abu bakr compilation"]},
    {code:"ISS 004",name:"Introduction to the Study of Hadith",desc:"Hadith · Isnad · Classification · Nawawi's 40",keywords:["hadith","sunnah","isnad","sanad","matn","narrator","chain","bukhari","muslim","tirmidhi","nawawi","forty hadith","sahih","hasan","daif","maudu","fabricated","mutawatir","ahad","mashhur","hadith classification","hadith terminology","rawi","muhaddith","preservation of sunnah","hadith collection","six books","kutub al-sittah","marfu","mawquf","hadith qudsi","nawawi collection","hadith 1","hadith 5","nawawi hadith","second source","islamic law sources"]},
  ],
  "Music":[
    {code:"MUS 001",name:"Basic Theory of Music",desc:"Notation · Scales · Key Signatures · Intervals · Rhythm",keywords:["music theory","notation","clef","treble clef","bass clef","staff","ledger line","key signature","time signature","note value","semibreve","minim","crotchet","quaver","rest","scale","major scale","minor scale","chromatic scale","pentatonic","interval","octave","semitone","tone","chord","triad","arpeggio","dynamics","tempo","italian terms","piano","forte","allegro","adagio","andante","sharp","flat","natural","accidental","bar line","double bar","repeat sign","key signatures","major key","minor key","circle of fifths","diatonic","enharmonic","tritone","diminished","augmented"]},
    {code:"MUS 002",name:"A Survey of African Music",desc:"African Instruments · Classification · Functions · Sources",keywords:["african music","idiophone","membranophone","aerophone","chordophone","classification","sekere","talking drum","dundun","gangan","kora","mbira","xylophone","african instrument","traditional music","functions of african music","sources of african music","ritual","ceremony","festival","call and response","polyrhythm","hemiola","cross rhythm","time line","west african music","highlife","juju","apala","fuji","afrobeats","cradle to grave","lamellophone","goje","oja","flute","dundun ensemble","ayan","yoruba music","igbo music","hausa music"]},
    {code:"MUS 003",name:"Basic Musicianship",desc:"Tonic Sol-fa · Melodic Dictation · Sight Reading · Cadences",keywords:["tonic solfa","sol-fa","doh","re","mi","fah","soh","lah","teh","sight reading","ear training","melodic dictation","transcription","melody","harmony","counterpoint","voice","soprano","alto","tenor","bass","choir","ensemble","quartet","duet","trio","cadence","perfect cadence","plagal cadence","amen cadence","imperfect cadence","interrupted cadence","modulation","transposition","musical phrase","period","question answer phrase","voice leading","part writing","figured bass","scale degrees","tonic","dominant","subdominant","mediant","submediant","leading note","supertonic"]},
    {code:"MUS 004",name:"Music Appreciation",desc:"Music History · Periods · Composers · Forms · Genres",keywords:["music history","baroque","classical period","romantic period","renaissance","modern music","bach","handel","haydn","mozart","beethoven","brahms","chopin","schubert","schumann","opera","oratorio","symphony","sonata","concerto","suite","fugue","rondo","binary form","ternary form","strophic","theme and variations","messiah","well-tempered clavier","water music","marriage of figaro","hallelujah chorus","nigerian composers","ayo bankole","t.k.e. phillips","ben odiase","prince nico mbarga","sweet mother","victor uwaifo","ebenezer obey","haruna ishola","sunny okosun","lucky dube","miriam makeba","renaissance meaning","rebirth"]},
  ],
  "Visual Arts":[
    {code:"VSA 001",name:"Art History",desc:"Prehistoric Art · Ancient Civilisations · Nigerian Art · African Art",keywords:["art history","prehistoric","paleolithic","mesolithic","neolithic","ancient egypt","pyramid","sphinx","greek art","roman art","renaissance","michelangelo","leonardo","raphael","baroque","impressionism","cubism","surrealism","expressionism","modernism","ife art","benin art","nok","igbo ukwu","esie","court art","naturalism","aina onabolu","zaria art school","ben enweonwu","bruce onobrakpeya","uche okeke","african art","nigerian art","leo frobenius","contrapposto","diskobolos","myron","picasso","braque","monet","van gogh","cezanne","ife bronze","benin bronze","prehistoric period","venus of willendorf","cave painting","giza","pharaoh","tutankhamun"]},
    {code:"VSA 002",name:"Two Dimensional Design",desc:"Drawing · Painting · Colour Theory · Graphic Design",keywords:["drawing","painting","colour","color","hue","value","chroma","intensity","primary colour","secondary colour","tertiary colour","complementary","perspective","vanishing point","horizon","shading","hatching","stippling","still life","landscape","portrait","figure drawing","plein air","outdoor study","oil paint","watercolour","gouache","pastel","charcoal","ink","composition","design elements","line","shape","texture","form","graphic design","typography","logo","layout","poster","printing","serigraphy","lithography","sfumato","monochrome","fixative","donkey","drawing horse","highlight","cast shadow","tone","tonal value","life drawing","nature study","colour wheel"]},
    {code:"VSA 003",name:"Three Dimensional Design",desc:"Sculpture · Ceramics · Casting · Modelling",keywords:["sculpture","ceramics","pottery","clay","coiling","pinching","slab","throwing","kiln","firing","bisque","biscuit","glaze","slip","grog","plasticity","greenware","terracotta","armature","subtractive","additive","carving","casting","lost wax","cire perdue","bronze","maquette","relief","bas relief","plaque","modelling","moulding","installation","three dimensional","3d design","stone carving","wood carving","reduction","ribbon tool","loop tool","wedging","kneading","rib tool","primary clay","secondary clay","temperature","pyrometer","raku","salt glaze"]},
    {code:"VSA 004",name:"The Decorative Arts & Other Craft Traditions",desc:"Textile · Basketry · Beading · Metalwork · Origami · Junk Art",keywords:["craft","textile","weaving","loom","warp","weft","batik","tie dye","adire","dyeing","embroidery","beading","bead","jewellery","jewelry","metalwork","goldsmithing","silver","copper","brass","bronze casting","foundry","basket weaving","cane","spoke","weaver","origami","paper folding","papier mache","junk art","waste art","mixed media","collage","assemblage","recycled","craft traditions","nigerian craft","aso-oke","akwete","kente","ladi kwali","abuja pottery","ndoki","tie-and-dye","squeegee","tjanting","batik wax","fibre","findings","pallion","soldering","macrame","paper bead","spokes","weavers"]},
  ],
  "Yoruba":[
    {code:"YOR 001",name:"Language I – Yoruba Phonetics & Phonology",desc:"Vowels · Consonants · Tone · Syllable Structure",keywords:["yoruba phonetics","phonology","fáwẹlì","kónsónántì","nasal","tone","ìpèdè","loanword","labiovelar","fricative","bilabial","alveolar","velar","àárín","vowel harmony","syllable structure","KF","tone mark","high tone","low tone","downstep","àfàsẹ","ẹdòfóró","place of articulation","manner of articulation","àfòmọ́","ìdíwò","ìró fáwẹlì","ìró kónsónántì","àpẹẹrẹ","ìpèdè ọlọ́pàá","ìró ohùn","semi-vowel","àfipè","ìbẹrẹ","kòẹ́"]},
    {code:"YOR 002",name:"Literature I – Yoruba Oral Literature",desc:"Ìjálá · Ifá · Ẹkún Ìyàwó · Àló · Oral Tradition",keywords:["oral literature","ìjálá","ifá","odù ifá","ẹṣẹ ifá","ẹkún ìyàwó","rárà","ìrèmòjé","ẹsà egúngún","àló","proverb","oriki","orin","song","funeral","praise poetry","lament","riddle","iyere ifa","oral tradition","yoruba culture","masquerade","egungun","àpamọ́","àpọnjú","ìjókòó","obitun","oral performance","storytelling","ọdẹ","àwọn ọdẹ","babalawo","babalawos","oral forms","àló àpamọ́","ijinlẹ àyànmọ́"]},
    {code:"YOR 003",name:"Language II – Yoruba Grammar",desc:"Morphology · Syntax · Word Formation · Parts of Speech",keywords:["yoruba grammar","morphology","syntax","ọ̀rọ̀ orúkọ","ọ̀rọ̀ arọ́pò-orúkọ","ọ̀rọ̀ ìṣe","ọ̀rọ̀ àpọ́nlé","ọ̀rọ̀ àsopọ̀","gbólóhùn","àpólà","ẹ̀yán","olùwà","sentence","subject","predicate","object","phrase","clause","word formation","compounding","reduplication","àfòmọ́-ìbẹrẹ","àfòmọ́-àárín","àpètúnpè","negation","interrogative","imperative","declarative","verb phrase","noun phrase","àkànpọ̀","tense","aspect","yoruba morphology","parts of speech","àpétúnpè","ìlànà àlà"]},
    {code:"YOR 004",name:"Literature II – Yoruba Written Literature",desc:"Novels · Drama · Poetry · Literary Analysis",keywords:["yoruba written literature","baṣọrun gaà","ìrèké oníbùdó","ẹmi ṣẹgilọlá","ìgbẹyìn ọmọ àbíìkọ","ẹfúnṣetán aniwura","okédìjí","fálétí","adébáyọ faleti","isaac thomas","fagunwa","written yoruba","yoruba drama","yoruba novel","yoruba poetry","literary analysis","theme","character","setting","plot","nígbà tàwa","okédòkun","ewì","akéwì","ìtàn àròsọ","ìtàn","protagonist","antagonist","kókó-ọ̀rọ̀","literary criticism","ìrìn-àjò","ojú-ìwòye","ìwéfún","ọmọ àbíìkọ","ìgbádùn"]},
  ],
  "Igbo":[
    {code:"IGB 001",name:"Fundamentals of Igbo Phonology",desc:"Vowels · Consonants · Tone · Syllable · Vowel Harmony",keywords:["igbo phonology","ụdaume","mgbochiume","tone","syllable","vowel harmony","ndakọrịta ụdaume","nasal","labial","bilabial","velar","alveolar","fricative","affricate","plosive","place of articulation","manner of articulation","ụdaimi","ụdaala","downstep","nsụda","high tone","low tone","IPA","phonetic transcription","elision","assimilation","ndapụ ụdaume","ndapụ mgbochiume","loanword","borrowing","semivowel","myiriụdaume","ụdaike","ụdampụta","ụdazụ","nkejiokwu","syllable structure","akara ụdaolu"]},
    {code:"IGB 002",name:"Fundamentals of Igbo Grammar",desc:"Morphology · Syntax · Sentence Types · Parts of Speech",keywords:["igbo grammar","morphology","syntax","aha","ngwaa","nkọwaaha","nnọchiaha","njikọ","mbuụzọ","ahịrịokwu","nkebiokwu","nganihu","isingwaa","nsonaazụ","noun phrase","verb phrase","ahịrịmmanye","ahịrịajụjụ","ahịrịntiiwu","negative","interrogative","imperative","declarative","nnọchiaha","tensị","onụọgụ","numeral","ideophone","nkwuwa","parts of speech","ahauche","ahauda","abstract noun","concrete noun","conjunction","preposition","adjective","complement","object","subject","predicate"]},
    {code:"IGB 003",name:"Fundamentals of Oral Igbo Literature",desc:"Folktale · Poetry · Proverbs · Riddles · Masquerade",keywords:["igbo oral literature","ifo","ilu","proverb","riddle","akpaalaokwu","akwamozu","lullaby","war song","abụ agha","masquerade","mmonwu","ejije mmọnwụ","praise song","oral poetry","abụ","ụkabụilu","asịnilu","storytelling","narrator","ọkọọ","ogee","audience","oral tradition","oral performance","akwa","ụra","ezumike","akụkọ ọnụ","oral forms","oral entertainment","agụmagụ ọnụ","nkọkịrịkọ","ifo characteristics","tortoise","mbe","folktale structure","mmalite","keesirihụ","orurugha"]},
    {code:"IGB 004",name:"Fundamentals of Written Igbo Literature",desc:"Omenụkọ · Drama · Poetry · Novel · Literary Analysis",keywords:["igbo written literature","omenụkọ","pita nwana","ọjaadịlị","achara","akpa uche","udo ka mma","ala bingo","nwaada lọọlọ","ejije","drama","abụ","iduuazị","novel","poetry","written literature","agụmagụ ederede","literary analysis","theme","character","plot","setting","symbol","figure of speech","metaphor","simile","personification","mmemmadụ","mbụrụ","ndịka","author","literary criticism","igbo fiction","ekemma","adaku","okorọgụ","egbentụ","ọkaaọgbaa","mkpụrụ onye kụrụ","ejije genres","ejije ọdachi","ejije ntọọchị"]},
  ],
};

// Map a question's topic string → course code for its subject
// Uses BIDIRECTIONAL matching: topic.includes(keyword) OR keyword.includes(topic)
// Also checks COURSE_ALIASES for short topic names that long phrases miss.
function getQuestionCourse(subject,topic){
  if(!topic||!JUPEB_COURSES[subject])return null;
  const tl=topic.toLowerCase().trim();
  const courses=JUPEB_COURSES[subject];
  const aliases=COURSE_ALIASES[subject]||{};
  for(const c of courses){
    // Pass 1: original keywords — topic contains keyword (existing behaviour)
    if(c.keywords.some(kw=>tl.includes(kw.toLowerCase())))return c.code;
    // Pass 2: short aliases — bidirectional (catches "Vectors", "Kinematics", etc.)
    const extraKws=aliases[c.code]||[];
    if(extraKws.some(kw=>{const kl=kw.toLowerCase();return tl.includes(kl)||kl.includes(tl);}))return c.code;
  }
  return null;
}
// Search ALL subjects to find which course a topic belongs to
function findTopicCourse(topic){
  if(!topic)return{subject:null,code:null};
  const tl=topic.toLowerCase();
  for(const[subject,courses]of Object.entries(JUPEB_COURSES)){
    if(!courses)continue;
    for(const c of courses){
      if(c.keywords.some(kw=>tl.includes(kw.toLowerCase())))return{subject,code:c.code};
    }
  }
  return{subject:null,code:null};
}
// Filter question bank to a specific course unit.
// If fewer than 10 questions match (keyword gap), pads with orphan questions
// (unclassified topics) from the same subject so drills never run dry.
function getQuestionsForCourse(QB,subject,courseCode){
  const all=getAllQuestionsForSubject(QB,subject);
  const matched=[];const orphans=[];
  for(const q of all){
    const code=getQuestionCourse(subject,q.topic);
    if(code===courseCode)matched.push(q);
    else if(!code)orphans.push(q); // topic didn't match ANY unit — collect as fallback
  }
  if(matched.length>=10)return matched;
  // Below floor: shuffle orphans and pad up to 20 so the unit is always drillable
  const shuffled=[...orphans].sort(()=>Math.random()-0.5);
  return[...matched,...shuffled.slice(0,Math.max(0,20-matched.length))];
}
// Add course code label to a topic string
function labelWithCourse(subject,topic){
  const code=getQuestionCourse(subject,topic);
  return code?`${code} · ${topic}`:topic;
}

const COURSE_GROUPS = {
  "Sciences":        { courses:["Medicine / Surgery","Pharmacy","Nursing","Engineering","Computer Science","Architecture"], subjects:["Physics","Chemistry","Biology","Mathematics"] },
  "Humanities":      { courses:["Law","Mass Communication"], subjects:["Government","Literature in English","CRS","Geography"] },
  "Social Sciences": { courses:["Accounting","Economics"], subjects:["Economics","Accounting","Government","Business Studies"] },
  "Arts & Languages":{ courses:["Theatre Arts","Education","Linguistics","Islamic Studies","Fine Arts","Music Education"], subjects:["History","French","Islamic Religious Studies","Music","Visual Arts","Yoruba","Igbo"] },
};
const ALL_COURSES = ["Medicine / Surgery","Law","Engineering","Computer Science","Pharmacy","Architecture","Accounting","Economics","Mass Communication","Nursing","Theatre Arts","Education","Linguistics","Islamic Studies","Fine Arts","Music Education","Other"];
const HEARD_OPTIONS = ["Friend","WhatsApp group","School","TikTok","X","Other"];
// ─── FOUNDER ACCESS ───────────────────────────────────────────────────────────
// Put your login email(s) here (lowercase). Anyone in this list sees the Founder Dashboard in Profile.
const FOUNDER_EMAILS = ["taiwooloyedewrites@gmail.com","favourwrites@gmail.com"];
const isFounder = u => !!u?.email && FOUNDER_EMAILS.includes(u.email.toLowerCase());
const FUTURES = { "Medicine / Surgery":"Doctor","Law":"Lawyer","Engineering":"Engineer","Computer Science":"Tech Leader","Pharmacy":"Pharmacist","Architecture":"Architect","Accounting":"Accountant","Economics":"Economist","Mass Communication":"Media Pro","Nursing":"Nurse","Theatre Arts":"Artist","Education":"Educator","Linguistics":"Linguist","Islamic Studies":"Islamic Scholar","Fine Arts":"Creative","Music Education":"Musician","Other":"Graduate" };
const CELEBRATE_COPY = {
  "Medicine / Surgery":{ win:"That's the mark of a future Doctor.", push:"The hospital is waiting. Get back up." },
  "Law":{ win:"Arguments like that win cases.", push:"Every lawyer lost before they won." },
  "Engineering":{ win:"Precision. That's what builds bridges.", push:"Every structure starts with a failed draft." },
  "Computer Science":{ win:"You just shipped clean code.", push:"Debug the gaps. Ship again." },
  "Pharmacy":{ win:"Accurate. Careful. That's who heals people.", push:"The prescription isn't perfect yet." },
  "Architecture":{ win:"Beautiful structure. Strong foundation.", push:"The blueprint needs one more revision." },
  "Accounting":{ win:"The numbers add up. So do you.", push:"Balance the books. Try again." },
  "Economics":{ win:"You understand how the world moves.", push:"Every model fails before it predicts correctly." },
  "Mass Communication":{ win:"Clear signal. Strong message.", push:"The story isn't finished yet." },
  "Nursing":{ win:"Steady hands. Sharp mind. That's care.", push:"Patients need you sharp." },
  "Theatre Arts":{ win:"The stage belongs to those who prepare.", push:"Every great performance starts over." },
  "Education":{ win:"You teach what you master. Well done.", push:"The best teachers never stop learning." },
  "Linguistics":{ win:"Language mastered. That's rare.", push:"Every word matters. Study them again." },
  "Islamic Studies":{ win:"Knowledge is the foundation of faith.", push:"Seek it until you find it." },
  "Fine Arts":{ win:"Creativity backed by knowledge. Powerful.", push:"The canvas is still blank. Fill it." },
  "Music Education":{ win:"Every note counts. You hit them all.", push:"The rhythm is still off. Practice again." },
  "Other":{ win:"You're building something. Don't stop.", push:"Not yet. But you're here." },
};

// ─── JUPEB 2026 OFFICIAL TIMETABLE ───────────────────────────────────────────
const JUPEB_TIMETABLE = [
  // WEEK 1 — MCQ/CBT
  { date:"2026-08-03", label:"Mon 3 Aug", type:"MCQ/CBT", color:"#4ade80", subjects:["Economics","Agricultural Science","Accounting","Yoruba","Igbo","Music"], note:"Briefing 8:30–9:30 · Economics 10:00–11:00 · Econ/Yoruba/Igbo/Music 1:30–2:30 · Agric 3:00–4:00 · Accounting/Agric 4:30–5:30" },
  { date:"2026-08-04", label:"Tue 4 Aug", type:"MCQ/CBT", color:"#4ade80", subjects:["Physics","Government","History"], note:"Physics 8:30–9:30 · Physics/History 10:00–11:00 · Government 1:30–2:30" },
  { date:"2026-08-05", label:"Wed 5 Aug", type:"MCQ/CBT", color:"#4ade80", subjects:["Chemistry","Business Studies","Literature in English"], note:"Chemistry 8:30–11:00 · Business Studies 3:00–4:00 · Literature 4:30–5:30" },
  { date:"2026-08-06", label:"Thu 6 Aug", type:"MCQ/CBT", color:"#4ade80", subjects:["Biology","Mathematics","CRS","Islamic Religious Studies","French","Geography","Visual Arts"], note:"Biology/French 8:30–9:30 · Bio/Visual Arts 10:00–11:00 · Bio/Geo 11:30–12:30 · Maths 1:30–2:30 · Maths/CRS/ISS 4:30–5:30" },
  { date:"2026-08-07", label:"Fri 7 Aug", type:"Practical", color:"#60a5fa", subjects:["Physics","French"], note:"Physics Practical & French Practical — all day" },
  // WEEK 2 — Essay/Practical
  { date:"2026-08-10", label:"Mon 10 Aug", type:"Essay", color:"#B8973E", subjects:["Yoruba","Igbo","History","Agricultural Science","French","Music","Physics"], note:"Yoruba/Igbo Essay 8–10 · History/Agric 10:30–12:30 · Physics Essay 1–3 · French/Music 3:30–5:30" },
  { date:"2026-08-11", label:"Tue 11 Aug", type:"Essay", color:"#B8973E", subjects:["Chemistry","CRS","Islamic Religious Studies","Business Studies","Mathematics","Government"], note:"Chemistry Essay 8–10 · CRS/ISS/Business Studies 10:30–12:30 · Maths Essay 1–3 · Government Essay 3:30–5:30" },
  { date:"2026-08-12", label:"Wed 12 Aug", type:"Essay", color:"#B8973E", subjects:["Biology","Geography","Literature in English","Accounting","Economics","Visual Arts"], note:"Biology/Geo Essay 8–10 · Literature/Accounting 10:30–12:30 · Economics/Visual Arts 1–3" },
  { date:"2026-08-13", label:"Thu 13 Aug", type:"Practical", color:"#60a5fa", subjects:["Chemistry","Music","Agricultural Science","Visual Arts"], note:"Chemistry & Music Practical (AM) · Agric & Visual Arts Practical (PM)" },
  { date:"2026-08-14", label:"Fri 14 Aug", type:"Practical", color:"#60a5fa", subjects:["Biology"], note:"Biology Practical — EXAM ENDS" },
];

// ─── CAMPUS AMBASSADOR TIERS ──────────────────────────────────────────────────
const AMBASSADOR_TIERS = [
  { name:"Bronze", emoji:"🥉", min:1,  max:4,   color:"#CD7F32", reward:"Bronze badge + community recognition" },
  { name:"Silver", emoji:"🥈", min:5,  max:14,  color:"#C0C0C0", reward:"Silver badge + 1-month premium boost" },
  { name:"Gold",   emoji:"🥇", min:15, max:29,  color:"#FFD700", reward:"Gold badge + extended premium access" },
  { name:"Platinum",emoji:"💎",min:30, max:999, color:"#B8973E", reward:"Platinum badge + prize pool entry + featured" },
];

const GRADE_CONFIG = {
  "A+":{ gradeColor:"#FFD700",glowRgb:"255,215,0",bgBase:"#020C08",bgMid:"#051408",label:"PERFECT SCORE",tagline:"Exceptional." },
  "A": { gradeColor:"#4ade80",glowRgb:"74,222,128",bgBase:"#020D08",bgMid:"#061510",label:"DISTINCTION",tagline:"Exam-ready." },
  "B": { gradeColor:"#B8973E",glowRgb:"184,151,62",bgBase:"#06080E",bgMid:"#080C18",label:"CREDIT",tagline:"Strong." },
  "C": { gradeColor:"#f97316",glowRgb:"249,115,22",bgBase:"#0A0800",bgMid:"#12100A",label:"PASS",tagline:"Keep going." },
  "D": { gradeColor:"#fb923c",glowRgb:"251,146,60",bgBase:"#0C0700",bgMid:"#180E06",label:"NEAR MISS",tagline:"Almost." },
  "F": { gradeColor:"#ef4444",glowRgb:"239,68,68", bgBase:"#0D0303",bgMid:"#1A0606",label:"FAIL",tagline:"Get back up." },
};

// ─── JUPEB POINTS ENGINE ──────────────────────────────────────────────────────
// Converts accuracy% → JUPEB grade letter and points
function jupebGrade(accuracy) {
  if(accuracy>=70)return{grade:"A",points:5,label:"A (5 pts)",color:"#4ade80"};
  if(accuracy>=60)return{grade:"B",points:4,label:"B (4 pts)",color:"#B8973E"};
  if(accuracy>=50)return{grade:"C",points:3,label:"C (3 pts)",color:"#f97316"};
  if(accuracy>=45)return{grade:"D",points:2,label:"D (2 pts)",color:"#fb923c"};
  if(accuracy>=40)return{grade:"E",points:1,label:"E (1 pt)", color:"#ef4444"};
  return{grade:"F",points:0,label:"F (0 pts)",color:"#ef4444"};
}
// Calculates total JUPEB points from an array of per-subject accuracy %
function projectedPoints(subjectAccuracies) {
  if(!subjectAccuracies||subjectAccuracies.length===0)return{total:0,breakdown:[],bonus:false};
  const breakdown=subjectAccuracies.map(({subject,accuracy})=>({
    subject,
    ...jupebGrade(accuracy??0),
    estimated:accuracy==null,
  }));
  const base=breakdown.reduce((s,x)=>s+x.points,0);
  const bonus=breakdown.every(x=>x.grade!=="F")?1:0;
  return{total:base+bonus,breakdown,bonus:bonus===1};
}
// Target points → needed grades description
function pointsToGrades(pts) {
  const map={16:"A,A,A + bonus",15:"A,A,A (no bonus)",14:"A,A,B + bonus",13:"B,B,B + bonus",12:"B,B,C + bonus",11:"B,C,C + bonus",10:"C,C,C + bonus",9:"C,C,D + bonus",8:"C,D,D + bonus"};
  return map[pts]||`${pts} points`;
}
// Min points required by popular courses
// ─── UNIVERSITIES DATA — Admission Intelligence Engine ────────────────────────
const UNIVERSITIES_DATA=[
  // ── TIER 1: Elite Federal ────────────────────────────────────────────────────
  {name:"University of Lagos",shortName:"UNILAG",tier:1,type:"Federal",location:"Lagos",state:"Lagos",acceptsJUPEB:true,searchAliases:["lag","lagos uni"],popularRank:1,courses:{
    "Medicine / Surgery":{minPoints:16,label:"Highly Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:15,label:"Highly Competitive",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:14,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:13,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Architecture":{minPoints:13,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:13,label:"Competitive",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:12,label:"Moderate",combination:["Mathematics","Economics","Government"]},
    "Mass Communication":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Nursing":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"University of Ibadan",shortName:"UI",tier:1,type:"Federal",location:"Ibadan, Oyo",state:"Oyo",acceptsJUPEB:true,searchAliases:["ibadan","u.i"],popularRank:2,courses:{
    "Medicine / Surgery":{minPoints:15,label:"Highly Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:14,label:"Highly Competitive",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:13,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:13,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Nursing":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Economics":{minPoints:12,label:"Moderate",combination:["Mathematics","Economics","Government"]},
    "Mass Communication":{minPoints:11,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Accounting":{minPoints:12,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
  }},
  {name:"Obafemi Awolowo University",shortName:"OAU",tier:1,type:"Federal",location:"Ile-Ife, Osun",state:"Osun",acceptsJUPEB:true,searchAliases:["ife","ile ife","awolowo","o.a.u"],popularRank:3,courses:{
    "Medicine / Surgery":{minPoints:15,label:"Highly Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:14,label:"Highly Competitive",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:13,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:12,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Architecture":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:12,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Government"]},
    "Mass Communication":{minPoints:11,label:"Moderate",combination:["Literature in English","Government","Economics"]},
  }},
  {name:"Ahmadu Bello University",shortName:"ABU",tier:1,type:"Federal",location:"Zaria, Kaduna",state:"Kaduna",acceptsJUPEB:true,searchAliases:["zaria","bello","abu zaria"],popularRank:6,courses:{
    "Medicine / Surgery":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:13,label:"Competitive",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:13,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Architecture":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"University of Nigeria, Nsukka",shortName:"UNN",tier:1,type:"Federal",location:"Nsukka, Enugu",state:"Enugu",acceptsJUPEB:true,searchAliases:["nsukka","enugu"],popularRank:4,courses:{
    "Medicine / Surgery":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:13,label:"Competitive",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:12,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Accounting":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Government"]},
    "Mass Communication":{minPoints:10,label:"Moderate",combination:["Literature in English","Government","Economics"]},
  }},
  {name:"University of Benin",shortName:"UNIBEN",tier:1,type:"Federal",location:"Benin City, Edo",state:"Edo",acceptsJUPEB:true,searchAliases:["benin","edo"],popularRank:5,courses:{
    "Medicine / Surgery":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:13,label:"Competitive",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:12,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Architecture":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Nursing":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"University of Ilorin",shortName:"UNILORIN",tier:1,type:"Federal",location:"Ilorin, Kwara",state:"Kwara",acceptsJUPEB:true,searchAliases:["ilorin","kwara"],popularRank:7,courses:{
    "Medicine / Surgery":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:13,label:"Competitive",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:12,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Accounting":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Government"]},
    "Nursing":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"University of Port Harcourt",shortName:"UNIPORT",tier:1,type:"Federal",location:"Port Harcourt, Rivers",state:"Rivers",acceptsJUPEB:true,searchAliases:["port harcourt","rivers"],popularRank:8,courses:{
    "Medicine / Surgery":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:13,label:"Competitive",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:12,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Accounting":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"University of Uyo",shortName:"UNIUYO",tier:1,type:"Federal",location:"Uyo, Akwa Ibom",state:"Akwa Ibom",acceptsJUPEB:true,searchAliases:["uyo","akwa ibom"],popularRank:9,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Nursing":{minPoints:11,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"Nnamdi Azikiwe University",shortName:"UNIZIK",tier:1,type:"Federal",location:"Awka, Anambra",state:"Anambra",acceptsJUPEB:true,searchAliases:["awka","anambra","azikiwe"],popularRank:10,courses:{
    "Medicine / Surgery":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:13,label:"Competitive",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Accounting":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Nursing":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"Federal University of Technology, Akure",shortName:"FUTA",tier:1,type:"Federal",location:"Akure, Ondo",state:"Ondo",acceptsJUPEB:true,searchAliases:["akure","ondo"],popularRank:11,courses:{
    "Engineering":{minPoints:13,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:13,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Architecture":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
  }},
  {name:"Federal University of Technology, Owerri",shortName:"FUTO",tier:1,type:"Federal",location:"Owerri, Imo",state:"Imo",acceptsJUPEB:true,searchAliases:["owerri","imo","futo"],popularRank:12,courses:{
    "Engineering":{minPoints:13,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:12,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Architecture":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
  }},
  {name:"University of Abuja",shortName:"UNIABUJA",tier:1,type:"Federal",location:"Gwagwalada, FCT",state:"FCT",acceptsJUPEB:true,searchAliases:["abuja","fct","gwagwalada","uni abuja"],popularRank:14,courses:{
    "Law":{minPoints:13,label:"Competitive",combination:["Literature in English","Government","Economics"]},
    "Medicine / Surgery":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Engineering":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Government"]},
    "Mass Communication":{minPoints:10,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Business Administration":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Federal University, Oye-Ekiti",shortName:"FUOYE",tier:1,type:"Federal",location:"Oye-Ekiti, Ekiti",state:"Ekiti",acceptsJUPEB:true,searchAliases:["fuoye","oye ekiti","ekiti federal"],popularRank:15,courses:{
    "Medicine / Surgery":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Nursing":{minPoints:10,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
    "Agriculture":{minPoints:8,label:"Accessible",combination:["Biology","Chemistry","Agricultural Science"]},
  }},
  {name:"Federal University Ndufu-Alike Ikwo",shortName:"FUNAI",tier:1,type:"Federal",location:"Ikwo, Ebonyi",state:"Ebonyi",acceptsJUPEB:true,searchAliases:["funai","ndufu alike","ikwo","ebonyi federal"],popularRank:16,courses:{
    "Medicine / Surgery":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
    "Agriculture":{minPoints:8,label:"Accessible",combination:["Biology","Chemistry","Agricultural Science"]},
  }},
  {name:"Federal University of Petroleum Resources",shortName:"FUPRE",tier:1,type:"Federal",location:"Effurun, Delta",state:"Delta",acceptsJUPEB:true,searchAliases:["fupre","effurun","petroleum resources","delta federal"],popularRank:17,courses:{
    "Engineering":{minPoints:13,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Geoscience":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Economics":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Michael Okpara University of Agriculture",shortName:"MOUAU",tier:1,type:"Federal",location:"Umudike, Abia",state:"Abia",acceptsJUPEB:true,searchAliases:["mouau","umudike","abia","okpara"],popularRank:18,courses:{
    "Agriculture":{minPoints:10,label:"Moderate",combination:["Biology","Chemistry","Agricultural Science"]},
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Veterinary Medicine":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
  }},
  {name:"Federal University of Agriculture, Abeokuta",shortName:"FUNAAB",tier:1,type:"Federal",location:"Abeokuta, Ogun",state:"Ogun",acceptsJUPEB:true,searchAliases:["abeokuta","ogun","agriculture"],popularRank:13,courses:{
    "Engineering":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Nursing":{minPoints:11,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  // ── TIER 2: State Universities ───────────────────────────────────────────────
  {name:"Lagos State University",shortName:"LASU",tier:2,type:"State",location:"Lagos",state:"Lagos",acceptsJUPEB:true,searchAliases:["lasu","lagos state"],popularRank:14,courses:{
    "Medicine / Surgery":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:13,label:"Competitive",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Government"]},
    "Mass Communication":{minPoints:10,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Nursing":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"Delta State University",shortName:"DELSU",tier:2,type:"State",location:"Abraka, Delta",state:"Delta",acceptsJUPEB:true,searchAliases:["delsu","delta","abraka"],popularRank:18,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
  }},
  {name:"Ekiti State University",shortName:"EKSU",tier:2,type:"State",location:"Ado-Ekiti, Ekiti",state:"Ekiti",acceptsJUPEB:true,searchAliases:["eksu","ekiti","ado ekiti"],popularRank:19,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Nursing":{minPoints:11,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"Osun State University",shortName:"UNIOSUN",tier:2,type:"State",location:"Osogbo, Osun",state:"Osun",acceptsJUPEB:true,searchAliases:["uniosun","osun","osogbo"],popularRank:20,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Nursing":{minPoints:11,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"Rivers State University",shortName:"RSU",tier:2,type:"State",location:"Port Harcourt, Rivers",state:"Rivers",acceptsJUPEB:true,searchAliases:["rsu","rivers state"],popularRank:21,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
  }},
  {name:"Imo State University",shortName:"IMSU",tier:2,type:"State",location:"Owerri, Imo",state:"Imo",acceptsJUPEB:true,searchAliases:["imsu","imo state"],popularRank:22,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Nursing":{minPoints:11,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"Ambrose Alli University",shortName:"AAU",tier:2,type:"State",location:"Ekpoma, Edo",state:"Edo",acceptsJUPEB:true,searchAliases:["aau","ekpoma","ambrose alli"],popularRank:23,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"Ebonyi State University",shortName:"EBSU",tier:2,type:"State",location:"Abakaliki, Ebonyi",state:"Ebonyi",acceptsJUPEB:true,searchAliases:["ebsu","ebonyi","abakaliki"],popularRank:24,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Nursing":{minPoints:11,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  // ── TIER 3: Private Universities ─────────────────────────────────────────────
  {name:"Olabisi Onabanjo University",shortName:"OOU",tier:2,type:"State",location:"Ago-Iwoye, Ogun",state:"Ogun",acceptsJUPEB:true,searchAliases:["oou","olabisi","ago iwoye","ogun state university"],popularRank:25,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Pharmacy":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Nursing":{minPoints:11,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
    "Mass Communication":{minPoints:9,label:"Accessible",combination:["Literature in English","Government","Economics"]},
    "Business Administration":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Ladoke Akintola University of Technology",shortName:"LAUTECH",tier:2,type:"State",location:"Ogbomoso, Oyo",state:"Oyo",acceptsJUPEB:true,searchAliases:["lautech","ogbomoso","oyo tech","ladoke"],popularRank:26,courses:{
    "Medicine / Surgery":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Pharmacy":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Engineering":{minPoints:13,label:"Competitive",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Architecture":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Agriculture":{minPoints:9,label:"Accessible",combination:["Biology","Chemistry","Agricultural Science"]},
  }},
  {name:"Niger Delta University",shortName:"NDU",tier:2,type:"State",location:"Wilberforce Island, Bayelsa",state:"Bayelsa",acceptsJUPEB:true,searchAliases:["ndu","niger delta","bayelsa","wilberforce"],popularRank:27,courses:{
    "Medicine / Surgery":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Nursing":{minPoints:11,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:11,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Enugu State University of Science and Technology",shortName:"ESUT",tier:2,type:"State",location:"Enugu",state:"Enugu",acceptsJUPEB:true,searchAliases:["esut","enugu state","enugu"],popularRank:28,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:11,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Business Administration":{minPoints:8,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Nasarawa State University, Keffi",shortName:"NSUK",tier:2,type:"State",location:"Keffi, Nasarawa",state:"Nasarawa",acceptsJUPEB:true,searchAliases:["nsuk","keffi","nasarawa"],popularRank:29,courses:{
    "Law":{minPoints:11,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Medicine / Surgery":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Engineering":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:9,label:"Accessible",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Tai Solarin University of Education",shortName:"TASUED",tier:2,type:"State",location:"Ijagun, Ogun",state:"Ogun",acceptsJUPEB:true,searchAliases:["tasued","tai solarin","ijagun","ogun education"],popularRank:30,courses:{
    "Education / Mathematics":{minPoints:9,label:"Accessible",combination:["Mathematics","Physics","Chemistry"]},
    "Education / Biology":{minPoints:9,label:"Accessible",combination:["Biology","Chemistry","Physics"]},
    "Education / English":{minPoints:9,label:"Accessible",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:9,label:"Accessible",combination:["Mathematics","Physics","Chemistry"]},
    "Economics":{minPoints:8,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Babcock University",shortName:"Babcock",tier:3,type:"Private",location:"Ilishan-Remo, Ogun",state:"Ogun",acceptsJUPEB:true,searchAliases:["babcock","ilishan"],popularRank:35,courses:{
    "Medicine / Surgery":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:11,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Government"]},
    "Mass Communication":{minPoints:10,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Nursing":{minPoints:12,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"Bowen University",shortName:"Bowen",tier:3,type:"Private",location:"Iwo, Osun",state:"Osun",acceptsJUPEB:true,searchAliases:["bowen","iwo"],popularRank:16,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Nursing":{minPoints:11,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"Afe Babalola University",shortName:"ABUAD",tier:3,type:"Private",location:"Ado-Ekiti, Ekiti",state:"Ekiti",acceptsJUPEB:true,searchAliases:["abuad","afe babalola"],popularRank:17,courses:{
    "Medicine / Surgery":{minPoints:14,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:13,label:"Competitive",combination:["Literature in English","Government","Economics"]},
    "Engineering":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Pharmacy":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
  }},
  {name:"Redeemer's University",shortName:"RUN",tier:3,type:"Private",location:"Ede, Osun",state:"Osun",acceptsJUPEB:true,searchAliases:["run","redeemers","ede"],popularRank:25,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:12,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Government"]},
    "Mass Communication":{minPoints:9,label:"Moderate",combination:["Literature in English","Government","Economics"]},
  }},
  {name:"Crawford University",shortName:"Crawford",tier:3,type:"Private",location:"Igbesa, Ogun",state:"Ogun",acceptsJUPEB:true,searchAliases:["crawford","igbesa","faith"],popularRank:26,courses:{
    "Law":{minPoints:11,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:9,label:"Moderate",combination:["Mathematics","Economics","Government"]},
    "Mass Communication":{minPoints:9,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Nursing":{minPoints:10,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
  }},
  {name:"Crescent University",shortName:"Crescent",tier:3,type:"Private",location:"Abeokuta, Ogun",state:"Ogun",acceptsJUPEB:true,searchAliases:["crescent","abeokuta private"],popularRank:27,courses:{
    "Law":{minPoints:11,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:9,label:"Moderate",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Ajayi Crowther University",shortName:"ACU",tier:3,type:"Private",location:"Oyo, Oyo",state:"Oyo",acceptsJUPEB:true,searchAliases:["acu","ajayi crowther"],popularRank:28,courses:{
    "Law":{minPoints:11,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Mass Communication":{minPoints:9,label:"Moderate",combination:["Literature in English","Government","Economics"]},
  }},
  {name:"Lead City University",shortName:"LCU",tier:3,type:"Private",location:"Ibadan, Oyo",state:"Oyo",acceptsJUPEB:true,searchAliases:["lcu","lead city"],popularRank:29,courses:{
    "Law":{minPoints:11,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Mass Communication":{minPoints:9,label:"Moderate",combination:["Literature in English","Government","Economics"]},
  }},
  {name:"Caleb University",shortName:"Caleb",tier:3,type:"Private",location:"Lagos",state:"Lagos",acceptsJUPEB:true,searchAliases:["caleb"],popularRank:30,courses:{
    "Law":{minPoints:11,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Mass Communication":{minPoints:9,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Economics":{minPoints:9,label:"Moderate",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Landmark University",shortName:"LMU",tier:3,type:"Private",location:"Omu-Aran, Kwara",state:"Kwara",acceptsJUPEB:true,searchAliases:["lmu","landmark","omu aran"],popularRank:31,courses:{
    "Engineering":{minPoints:12,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:10,label:"Moderate",combination:["Mathematics","Economics","Government"]},
    "Nursing":{minPoints:11,label:"Moderate",combination:["Biology","Chemistry","Physics"]},
    "Mass Communication":{minPoints:9,label:"Moderate",combination:["Literature in English","Government","Economics"]},
  }},
  {name:"Benson Idahosa University",shortName:"BIU",tier:3,type:"Private",location:"Benin City, Edo",state:"Edo",acceptsJUPEB:true,searchAliases:["biu","benson idahosa","idahosa","benin private"],popularRank:36,courses:{
    "Medicine / Surgery":{minPoints:13,label:"Competitive",combination:["Biology","Chemistry","Physics"]},
    "Law":{minPoints:11,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:10,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Business Administration":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
    "Mass Communication":{minPoints:9,label:"Accessible",combination:["Literature in English","Government","Economics"]},
  }},
  {name:"Achievers University",shortName:"AUO",tier:3,type:"Private",location:"Owo, Ondo",state:"Ondo",acceptsJUPEB:true,searchAliases:["achievers","owo","ondo private"],popularRank:37,courses:{
    "Law":{minPoints:10,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:9,label:"Accessible",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
    "Business Administration":{minPoints:8,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Bells University of Technology",shortName:"Bells",tier:3,type:"Private",location:"Ota, Ogun",state:"Ogun",acceptsJUPEB:true,searchAliases:["bells","ota ogun","bells tech"],popularRank:38,courses:{
    "Engineering":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Computer Science":{minPoints:11,label:"Moderate",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
    "Business Administration":{minPoints:8,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Fountain University",shortName:"FUO",tier:3,type:"Private",location:"Oshogbo, Osun",state:"Osun",acceptsJUPEB:true,searchAliases:["fountain","oshogbo private","fountain osun"],popularRank:39,courses:{
    "Law":{minPoints:10,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:9,label:"Accessible",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
    "Business Administration":{minPoints:8,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Hezekiah University",shortName:"HU",tier:3,type:"Private",location:"Umudi, Imo",state:"Imo",acceptsJUPEB:true,searchAliases:["hezekiah","umudi","imo private"],popularRank:40,courses:{
    "Law":{minPoints:10,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:9,label:"Accessible",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Business Administration":{minPoints:8,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Wellspring University",shortName:"WU",tier:3,type:"Private",location:"Irhirhi, Edo",state:"Edo",acceptsJUPEB:true,searchAliases:["wellspring","irhirhi","edo private"],popularRank:41,courses:{
    "Law":{minPoints:10,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:9,label:"Accessible",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Business Administration":{minPoints:8,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Kwararafa University",shortName:"KWU",tier:3,type:"Private",location:"Wukari, Taraba",state:"Taraba",acceptsJUPEB:true,searchAliases:["kwararafa","wukari","taraba"],popularRank:42,courses:{
    "Law":{minPoints:10,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:9,label:"Accessible",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Economics":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Government"]},
    "Business Administration":{minPoints:8,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  {name:"Paul University",shortName:"PU",tier:3,type:"Private",location:"Awka, Anambra",state:"Anambra",acceptsJUPEB:true,searchAliases:["paul university","awka private","paul awka"],popularRank:43,courses:{
    "Law":{minPoints:10,label:"Moderate",combination:["Literature in English","Government","Economics"]},
    "Computer Science":{minPoints:9,label:"Accessible",combination:["Mathematics","Physics","Chemistry"]},
    "Accounting":{minPoints:9,label:"Accessible",combination:["Mathematics","Economics","Accounting"]},
    "Business Administration":{minPoints:8,label:"Accessible",combination:["Mathematics","Economics","Government"]},
  }},
  // ── NON-JUPEB — searchable, shows warning ────────────────────────────────────
  {name:"Covenant University",shortName:"Covenant",tier:3,type:"Private",location:"Ota, Ogun",state:"Ogun",acceptsJUPEB:false,searchAliases:["covenant","ota","winners"],popularRank:99,jupebWarning:"Covenant University runs its own foundation programme and does not currently accept JUPEB through the standard pathway. Check their admissions portal directly.",courses:{}},
  {name:"Pan-Atlantic University",shortName:"PAU",tier:3,type:"Private",location:"Lagos",state:"Lagos",acceptsJUPEB:false,searchAliases:["pau","pan atlantic","lagos business school"],popularRank:99,jupebWarning:"Pan-Atlantic University does not currently accept JUPEB. Consider their direct entry options.",courses:{}},
  {name:"American University of Nigeria",shortName:"AUN",tier:3,type:"Private",location:"Yola, Adamawa",state:"Adamawa",acceptsJUPEB:false,searchAliases:["aun","american university","yola"],popularRank:99,jupebWarning:"AUN follows a US-style admissions process and does not currently accept JUPEB.",courses:{}},
];

const getRequiredPoints=(shortName,course)=>{const u=UNIVERSITIES_DATA.find(x=>x.shortName===shortName);return u?.courses[course]?.minPoints||13;};
const getPreferredSubjects=(shortName,course)=>{const u=UNIVERSITIES_DATA.find(x=>x.shortName===shortName);return u?.courses[course]?.combination||[];};
const getUnisForCourse=course=>UNIVERSITIES_DATA.filter(u=>u.acceptsJUPEB&&u.courses[course]);
const getTierLabel=tier=>tier===1?"🔥 Elite Federal":tier===2?"⭐ State Universities":"🏛️ Private Universities";
const searchUniversities=(query,courseFilter=null)=>{
  const q=(query||"").trim().toLowerCase();
  return UNIVERSITIES_DATA.filter(u=>{
    if(courseFilter&&!u.courses[courseFilter]&&u.acceptsJUPEB)return false;
    if(!q)return true;
    return(
      u.name.toLowerCase().includes(q)||
      u.shortName.toLowerCase().includes(q)||
      u.location.toLowerCase().includes(q)||
      (u.state||"").toLowerCase().includes(q)||
      (u.searchAliases||[]).some(a=>a.toLowerCase().includes(q))
    );
  }).sort((a,b)=>(a.popularRank||99)-(b.popularRank||99));
};
const IDB = {
  _db: null,
  async open() {
    if (this._db) return this._db;
    return new Promise((res, rej) => {
      const req = indexedDB.open("crediq_v1", 1);
      req.onupgradeneeded = e => { e.target.result.createObjectStore("cache", { keyPath:"key" }); };
      req.onsuccess = e => { this._db = e.target.result; res(this._db); };
      req.onerror = () => rej(req.error);
    });
  },
  async get(key) {
    try {
      const db = await this.open();
      return new Promise(res => {
        const req = db.transaction("cache","readonly").objectStore("cache").get(key);
        req.onsuccess = () => {
          const r = req.result;
          res(r && Date.now()-r.ts < 24*60*60*1000 ? r.data : null);
        };
        req.onerror = () => res(null);
      });
    } catch { return null; }
  },
  async set(key, data) {
    try {
      const db = await this.open();
      return new Promise(res => {
        const tx = db.transaction("cache","readwrite");
        tx.objectStore("cache").put({ key, data, ts:Date.now() });
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
      });
    } catch { return false; }
  }
};

// ─── STREAK SYSTEM (localStorage) ────────────────────────────────────────────
const Streak = {
  get() {
    const _uid=localStorage.getItem("cq_current_uid")||"anon";
    const last = localStorage.getItem("cq_sd_"+_uid);
    const count = parseInt(localStorage.getItem("cq_sc_"+_uid) || "0");
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now()-86400000).toDateString();
    if (last === today) return { count, studiedToday:true };
    if (last === yesterday) return { count, studiedToday:false };
    return { count:0, studiedToday:false };
  },
  bump() {
    const today = new Date().toDateString();
    const { count, studiedToday } = this.get();
    const newCount = studiedToday ? count : count+1;
    const _uid2=localStorage.getItem("cq_current_uid")||"anon";
    localStorage.setItem("cq_sd_"+_uid2, today);
    localStorage.setItem("cq_sc_"+_uid2, String(newCount));
    return newCount;
  }
};

// ─── SESSION PROTECTION (localStorage only tonight — wire to Firestore tmrw) ──
const Session = {
  generate() {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("cq_session_id", id);
    return id;
  },
  get() { return localStorage.getItem("cq_session_id"); },
  clear() { localStorage.removeItem("cq_session_id"); }
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const getFuture = c => FUTURES[c]||"Graduate";
const getGreet = () => { const h=new Date().getHours(); if(h>=22||h<4)return"Still at it,"; return h<12?"Good morning":h<17?"Good afternoon":"Good evening"; };
const grade = pct => pct>=70?"A":pct>=60?"B":pct>=50?"C":pct>=45?"D":"F";
const shareGrade = pct => pct>=90?"A+":pct>=70?"A":pct>=60?"B":pct>=50?"C":pct>=45?"D":"F";
const gradeColor = (g,T) => g==="A"?T.success:g==="B"?T.gold:(g==="C"||g==="D")?T.warn:T.danger;
const makeRef = uid => "CQ"+uid.slice(0,6).toUpperCase();

function daysUntil(dateStr) {
  const target = new Date(dateStr);
  const now = new Date();
  target.setHours(0,0,0,0); now.setHours(0,0,0,0);
  return Math.max(0, Math.ceil((target-now)/(1000*60*60*24)));
}

function getNextExam(userSubjects) {
  const today = new Date(); today.setHours(0,0,0,0);
  for (const entry of JUPEB_TIMETABLE) {
    const d = new Date(entry.date); d.setHours(0,0,0,0);
    if (d >= today && entry.subjects.some(s => userSubjects.includes(s))) {
      return { ...entry, days: Math.ceil((d-today)/(1000*60*60*24)) };
    }
  }
  return null;
}

function calcMastery(history, subject) {
  const relevant = history.filter(h=>h.subject===subject);
  if (!relevant.length) return 0;
  const avg = relevant.reduce((s,h)=>s+h.pct,0)/relevant.length;
  return Math.min(95, Math.round(avg*0.85 + Math.min(relevant.length*2,15)));
}

const STEM_SUBJECTS=["Physics","Chemistry","Mathematics","Biology","Economics","Geography","Agriculture","English"];
const RELIGIOUS_TERMS=["jahiliyyah","prophet","muhammad","quran","allah","islamic","madinah","makkah","mecca","medina","hadith","sunnah","caliphate","hijra","ukaz","taif","arafah","mosque","siffin","khadijah","uthman","abubakar","imam bukhari","nawawi","surah","umrah","hajj","salat","zakat","tawhid","shirk","aqeedah","baptism","crucifixion","apostle","genesis","exodus","deuteronomy","leviticus","old testament","new testament","holy ghost","holy spirit","ten commandments","passover","resurrection of","sermon on the mount"];
function isUsableQuestion(q){
  if(q.hasDiagram===true&&!q.diagramUrl)return false;
  if(STEM_SUBJECTS.includes(q.subject||"")){
    const text=(q.question||q.text||q.q||"").toLowerCase();
    const topic=(q.topic||q.subtopic||"").toLowerCase();
    const allText=text+" "+topic;
    if(RELIGIOUS_TERMS.some(kw=>allText.includes(kw)))return false;
    // Also filter by topic name directly
    if(topic.includes("quran")||topic.includes("islamic")||topic.includes("irs")||topic.includes("christian")||topic.includes("bible")||topic.includes("crs"))return false;
  }
  return true;
}
function getAllQuestionsForSubject(QB,subject) {
  if (!QB[subject]) return [];
  return Object.values(QB[subject]).flat().filter(isUsableQuestion);
}
function getQuestions(QB,subject,year) {
  const qs=(QB[subject]&&QB[subject][String(year)]) ? QB[subject][String(year)] : [];
  return qs.filter(isUsableQuestion);
}
function getMixedExam(QB,subjects,count=50) {
  let pool=[];
  subjects.forEach(sub=>getAllQuestionsForSubject(QB,sub).forEach(q=>pool.push({...q,subject:sub})));
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  return pool.slice(0,count);
}
function getQuestionsForDrill(QB,subjects,weakTopics,count=10) {
  let pool=[];
  subjects.forEach(sub=>{
    getAllQuestionsForSubject(QB,sub).forEach(q=>{
      if(!weakTopics.length||weakTopics.some(t=>q.topic&&q.topic.toLowerCase().includes(t.toLowerCase().split(" ")[0])))
        pool.push({...q,subject:sub});
    });
  });
  if(pool.length<count) subjects.forEach(sub=>getAllQuestionsForSubject(QB,sub).forEach(q=>pool.push({...q,subject:sub})));
  const seen=new Set();
  pool=pool.filter(q=>{const k=q.subject+q.id;if(seen.has(k))return false;seen.add(k);return true;});
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  return pool.slice(0,count);
}
function calcReadiness(history) {
  const clean=history.filter(isRealSession);
  if(!clean.length)return 0;
  const r=clean.slice(-10);
  return Math.round((r.reduce((s,h)=>s+h.pct,0)/r.length*0.7)+(Math.min(100,r.length*10)*0.3));
}
function calcWeakTopics(history) {
  // Returns plain topic strings (backward compat)
  return calcTopicStatus(history).weak.map(x=>typeof x==="string"?x:x.t);
}
// New: returns [{t, score, subject}] with subject attached
function calcWeakTopicsWithSubject(history) {
  return calcTopicStatus(history).weak;
}
// CLEAN_SUBJECTS: sessions that count toward real JUPEB subject tracking
const JUNK_SUBJECTS=["Mixed","Drill","Random Warm-Up","Random Practice",""];
const isRealSession=h=>h.subject&&!JUNK_SUBJECTS.includes(h.subject);

function calcSubjectStats(history) {
  const s={};
  history.filter(isRealSession).forEach(h=>{
    const k=h.subject;
    if(!s[k])s[k]={sessions:0,totalPct:0,best:0,totalDuration:0,lastDate:null};
    s[k].sessions++;
    s[k].totalPct+=h.pct;
    s[k].best=Math.max(s[k].best,h.pct);
    s[k].totalDuration+=(h.duration||0);
    const d=h.date||new Date().toISOString();
    if(!s[k].lastDate||d>s[k].lastDate)s[k].lastDate=d;
  });
  return s;
}
function calcStudyTime(history) {
  return Math.round(history.filter(isRealSession).reduce((s,h)=>s+(h.duration||0),0)/60);
}

// ─── PHASE 3: LEARNING SCIENCE ────────────────────────────────────────────────
function calcReadinessTrend(history) {
  if(history.length<2)return{points:[],delta:0,monthDelta:0};
  const size=Math.max(1,Math.floor(history.length/6));
  const points=[];
  for(let i=0;i<history.length;i+=size){
    const chunk=history.slice(i,i+size);
    points.push({score:Math.round(chunk.reduce((s,h)=>s+h.pct,0)/chunk.length)});
  }
  const delta=points.length>=2?points[points.length-1].score-points[0].score:0;
  const recent=history.slice(-Math.min(10,Math.ceil(history.length/2)));
  const older=history.slice(0,Math.min(10,Math.floor(history.length/2)));
  const monthDelta=older.length&&recent.length
    ?Math.round(recent.reduce((s,h)=>s+h.pct,0)/recent.length-older.reduce((s,h)=>s+h.pct,0)/older.length)
    :0;
  return{points,delta,monthDelta};
}
function calcReviewQueue(history) {
  const clean=history.filter(isRealSession);
  if(!clean.length)return[];
  const topicMap={};
  clean.forEach(h=>{
    const d=h.date||new Date().toISOString();
    (h.wrongTopics||[]).forEach(t=>{
      if(!topicMap[t])topicMap[t]={wrong:0,lastDate:d,subject:h.subject||""};
      topicMap[t].wrong++;
      if(d>topicMap[t].lastDate)topicMap[t].lastDate=d;
      if(!topicMap[t].subject&&h.subject)topicMap[t].subject=h.subject;
    });
  });
  const today=new Date();today.setHours(0,0,0,0);
  return Object.entries(topicMap).map(([topic,data])=>{
    const interval=data.wrong>=5?1:data.wrong>=3?2:data.wrong>=2?3:7;
    const last=new Date(data.lastDate);last.setHours(0,0,0,0);
    const daysSince=Math.max(0,Math.floor((today-last)/86400000));
    return{topic,wrong:data.wrong,dueIn:interval-daysSince,interval,subject:data.subject};
  }).filter(t=>t.dueIn<=0).sort((a,b)=>a.dueIn-b.dueIn).slice(0,5);
}
function calcTopicImprovement(history) {
  if(history.length<4)return[];
  const mid=Math.ceil(history.length/2);
  const rate=(sessions,topic)=>{
    const count=sessions.filter(h=>(h.wrongTopics||[]).includes(topic)).length;
    return sessions.length?Math.round((count/sessions.length)*100):0;
  };
  const older=history.slice(0,mid),recent=history.slice(mid);
  const allTopics=[...new Set(history.flatMap(h=>h.wrongTopics||[]))];
  return allTopics.map(t=>{
    const oldRate=rate(older,t),newRate=rate(recent,t);
    const delta=oldRate-newRate; // positive = fewer wrong = improvement
    return{topic:t,oldRate,newRate,delta};
  }).filter(t=>Math.abs(t.delta)>=10).sort((a,b)=>b.delta-a.delta).slice(0,6);
}
function calcTopicStatus(history) {
  const clean=history.filter(isRealSession);
  if(!clean.length)return{weak:[],improving:[],graduated:[],topicSubjectMap:{}};
  const recent5=clean.slice(-5);
  const older=clean.length>5?clean.slice(0,-5):[];
  const count=(sessions,topic)=>sessions.filter(h=>(h.wrongTopics||[]).includes(topic)).length;
  // Track which subject each topic came from
  const topicSubjectMap={};
  clean.forEach(h=>(h.wrongTopics||[]).forEach(t=>{if(!topicSubjectMap[t])topicSubjectMap[t]=h.subject;}));
  const allTopics=[...new Set(clean.flatMap(h=>h.wrongTopics||[]))];
  const weak=[],improving=[],graduated=[];
  allTopics.forEach(t=>{
    const totalWrong=count(clean,t);
    const recentWrong=count(recent5,t);
    const olderWrong=count(older,t);
    const wasWeak=olderWrong>=2&&older.length>=3;
    if(wasWeak&&recentWrong===0)graduated.push(t);
    else if(recentWrong>=2)weak.push({t,score:recentWrong*3+totalWrong,subject:topicSubjectMap[t]||""});
    else if(recentWrong>=1||totalWrong>=2)improving.push(t);
  });
  weak.sort((a,b)=>b.score-a.score);
  return{weak:weak.slice(0,8),improving:improving.slice(0,4),graduated:graduated.slice(0,3),topicSubjectMap};
}
function calcWeeklyMission(history,weakTopics,readiness,userSubjects=[]) {
  const goal=readiness<65?Math.min(readiness+8,70):Math.min(readiness+5,100);
  const topicStrings=weakTopics.map(x=>typeof x==="string"?x:x.t);
  const tasks=topicStrings.slice(0,2).map(t=>({topic:t,questions:15}));
  // Fallback: suggest practising their weakest subject, never "Mixed Practice"
  if(!tasks.length&&userSubjects.length){
    const subH=userSubjects.map(s=>({s,h:history.filter(h=>h.subject===s)}));
    const leastPractised=subH.sort((a,b)=>a.h.length-b.h.length)[0];
    tasks.push({topic:`${leastPractised.s} Practice`,questions:20});
  }
  const weekStart=new Date();
  weekStart.setDate(weekStart.getDate()-weekStart.getDay());weekStart.setHours(0,0,0,0);
  const thisWeek=history.filter(isRealSession).filter(h=>new Date(h.date)>=weekStart).length;
  return{goal,needed:Math.max(0,goal-readiness),tasks,progress:Math.min(100,Math.round((thisWeek/3)*100)),thisWeek,target:3};
}
// Per-subject topic map: returns each topic seen for a subject with accuracy + JUPEB-threshold colour status
function calcSubjectTopicMap(history,subject) {
  const subHistory=history.filter(h=>h.subject===subject);
  if(!subHistory.length)return[];
  const topicData={};
  subHistory.forEach(h=>{
    (h.questionResults||[]).forEach(r=>{
      if(!r.topic)return;
      if(!topicData[r.topic])topicData[r.topic]={correct:0,total:0};
      topicData[r.topic].total++;
      if(r.correct)topicData[r.topic].correct++;
    });
  });
  return Object.entries(topicData).map(([topic,d])=>{
    const acc=d.total?Math.round((d.correct/d.total)*100):0;
    let status,color,label;
    if(acc>=60){status="strong";color="#4ade80";label="On track";}
    else if(acc>=40){status="needs-work";color="#f97316";label="Needs work";}
    else{status="blocker";color="#ef4444";label="Score blocker";}
    return{topic,accuracy:acc,status,color,label,attempts:d.total};
  }).sort((a,b)=>a.accuracy-b.accuracy);
}
// Find which single topic is most limiting a subject's grade (the "why" explanation)
function findGradeLimiter(history,subject) {
  const map=calcSubjectTopicMap(history,subject);
  const blockers=map.filter(t=>t.status==="blocker"&&t.attempts>=2);
  if(blockers.length)return blockers[0];
  const needsWork=map.filter(t=>t.status==="needs-work"&&t.attempts>=2);
  if(needsWork.length)return needsWork[0];
  return null;
}

// ─── PENDING SESSIONS — offline backup ────────────────────────────────────────
// Saves session to localStorage before Firestore write.
// If write fails (bad network), data survives and syncs on next load.
const PendingSessions = {
  KEY: "cq_pending_v1",
  push(uid, data) {
    try {
      const all = this.getAll();
      const entry = {id: Date.now(), uid, data};
      all.push(entry);
      localStorage.setItem(this.KEY, JSON.stringify(all.slice(-5))); // keep last 5 max
    } catch(e) {}
  },
  getAll() {
    try { return JSON.parse(localStorage.getItem(this.KEY)||"[]"); } catch { return []; }
  },
  remove(id) {
    try {
      const all = this.getAll().filter(x => x.id !== id);
      localStorage.setItem(this.KEY, JSON.stringify(all));
    } catch(e) {}
  },
  clear() { try { localStorage.removeItem(this.KEY); } catch(e) {} }
};

// ─── FIREBASE HELPERS ─────────────────────────────────────────────────────────
const getUserDoc = async uid => { const s=await getDoc(doc(db,"users",uid)); return s.exists()?s.data():null; };
const createUserDoc = async (uid,{name,email,referredBy=null}) => {
  const referralCode=makeRef(uid);
  const data={uid,name,email,course:null,subjects:[],onboarded:false,isPremium:false,questionsToday:0,lastActiveDate:new Date().toDateString(),referralCode,referredBy,referralCount:0,referralBalance:0,weakTopics:[],streak:0,createdAt:serverTimestamp(),
    gradeHistory:[],averageGrade:null,totalSessionsCompleted:0,studyPattern:null,consistencyScore:0,lastSessionDate:null,strongTopics:[],masteryScores:{},examCentreRegion:null,
  };
  // These two are required — await them
  await setDoc(doc(db,"users",uid),data);
  await setDoc(doc(db,"referrals",referralCode),{uid,name,referralCode,signups:0,conversions:0,earnings:0,createdAt:serverTimestamp()});
  // Credit referrer in background — don't block signup
  if(referredBy){
    (async()=>{
      try{
        // Update existing referrals doc (legacy system)
        const refSnap=await getDoc(doc(db,"referrals",referredBy));
        if(refSnap.exists()){
          const signupEntry={uid,name,date:new Date().toISOString(),isPaid:false};
          await updateDoc(doc(db,"referrals",referredBy),{signups:increment(1),signupsList:arrayUnion(signupEntry)});
          const uq=query(collection(db,"users"),where("referralCode","==",referredBy));
          const uSnap=await getDocs(uq);
          if(!uSnap.empty){
            await updateDoc(doc(db,"users",uSnap.docs[0].id),{referralCount:increment(1)});
            // ── REFERRAL UNLOCK: auto-grant premium at 3 and 10 referrals ──
            const referrerSnap=await getDoc(doc(db,"users",uSnap.docs[0].id));
            const newCount=(referrerSnap.data()?.referralCount||0)+1;
            if(newCount===3){
              // 7 days free premium
              const expiry=new Date(Date.now()+7*24*60*60*1000).toISOString();
              await updateDoc(doc(db,"users",uSnap.docs[0].id),{isPremium:true,premiumExpiry:expiry,referralUnlock:"7days"});
            }else if(newCount===10){
              // Permanent premium
              await updateDoc(doc(db,"users",uSnap.docs[0].id),{isPremium:true,premiumExpiry:null,referralUnlock:"permanent"});
            }
          }
        }
        // First-touch attribution — update ambassadors collection (creates doc if not exists)
        await setDoc(doc(db,"ambassadors",referredBy.toUpperCase()),{
          code:referredBy.toUpperCase(),
          totalReferrals:increment(1),
          lastSignup:new Date().toISOString(),
        },{merge:true});
      }catch(e){console.error("Referral credit error:",e);}
    })();
  }
  return data;
};
const saveSession = async (userId,data) => addDoc(collection(db,"sessions"),{userId,...data,createdAt:serverTimestamp()});

// ─── DATA INFRASTRUCTURE v2 ───────────────────────────────────────────────────

// Time helpers
const getTimeOfDay = () => { const h=new Date().getHours(); if(h>=5&&h<12)return"morning"; if(h>=12&&h<17)return"afternoon"; if(h>=17&&h<22)return"evening"; return"night"; };
const getDayOfWeek = () => ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date().getDay()];
const EXAM_DATE_TARGET = new Date("2026-08-03");
const getDaysToExam = () => Math.max(0,Math.ceil((EXAM_DATE_TARGET-new Date())/(1000*60*60*24)));

// Detect JUPEB course unit (001-004) from topic text
const getCourseUnit = (subject,topic="") => {
  const courses=JUPEB_COURSES[subject];
  if(!courses)return null;
  const t=topic.toLowerCase();
  for(const c of courses){if(c.keywords.some(kw=>t.includes(kw)))return c.code;}
  return courses[0]?.code||null;
};

// Grade to number for averaging
const gradeToNum = g=>({A:90,B:75,C:60,D:50,F:30}[g]||50);
const numToGrade = n=>n>=70?"A":n>=60?"B":n>=50?"C":n>=45?"D":"F";

// Mastery subcollection — users/{uid}/mastery/{topic}
const updateMastery = async (uid,questionResults=[]) => {
  const byTopic={};
  questionResults.forEach(q=>{
    const topic=(q.topic||"General").replace(/[\/\.#\[\]]/g,"_");
    if(!byTopic[topic])byTopic[topic]={correct:0,wrong:0,times:[]};
    if(q.correct)byTopic[topic].correct++;
    else byTopic[topic].wrong++;
    if(q.timeSpent)byTopic[topic].times.push(q.timeSpent);
  });
  const today=new Date().toISOString().split("T")[0];
  await Promise.all(Object.entries(byTopic).map(async([topic,data])=>{
    const ref=doc(db,"users",uid,"mastery",topic);
    const snap=await getDoc(ref);
    const ex=snap.exists()?snap.data():{score:0,attempts:0,correctCount:0,wrongCount:0,history:[]};
    const newCorrect=(ex.correctCount||0)+data.correct;
    const newWrong=(ex.wrongCount||0)+data.wrong;
    const newAttempts=(ex.attempts||0)+data.correct+data.wrong;
    const newScore=newAttempts>0?Math.round((newCorrect/newAttempts)*100):0;
    const avgTime=data.times.length?Math.round(data.times.reduce((a,b)=>a+b,0)/data.times.length):(ex.averageTimeSpent||0);
    const resistanceScore=newAttempts>0?Math.round((newWrong/newAttempts)*100):0;
    const history=[...(ex.history||[]),{date:today,score:newScore}].slice(-30);
    await setDoc(ref,{score:newScore,attempts:newAttempts,correctCount:newCorrect,wrongCount:newWrong,lastUpdated:serverTimestamp(),averageTimeSpent:avgTime,resistanceScore,history});
  }));
};

// Engagement collection — engagement/{uid}
const updateEngagement = async (uid,{timeOfDay,dayOfWeek,streakCount}) => {
  const ref=doc(db,"engagement",uid);
  const snap=await getDoc(ref);
  const ex=snap.exists()?snap.data():{studyTimeDistribution:{morning:0,afternoon:0,evening:0,night:0},weekdayDistribution:{},totalSessions:0,longestStreak:0,crammerScore:0};
  const studyTime={...(ex.studyTimeDistribution||{morning:0,afternoon:0,evening:0,night:0})};
  studyTime[timeOfDay]=(studyTime[timeOfDay]||0)+1;
  const weekday={...(ex.weekdayDistribution||{})};
  weekday[dayOfWeek]=(weekday[dayOfWeek]||0)+1;
  const totalSessions=(ex.totalSessions||0)+1;
  const weeksActive=Math.max(1,Math.ceil(totalSessions/7));
  const averageSessionsPerWeek=Math.round((totalSessions/weeksActive)*10)/10;
  const longestStreak=Math.max(streakCount,ex.longestStreak||0);
  const crammerScore=streakCount>=7?Math.min(100,(ex.crammerScore||0)+5):(ex.crammerScore||0);
  const consistencyScore=Math.min(100,Math.round((streakCount/30)*100));
  await setDoc(ref,{studyTimeDistribution:studyTime,weekdayDistribution:weekday,totalSessions,averageSessionsPerWeek,longestStreak,currentStreak:streakCount,crammerScore,consistencyScore,lastUpdated:serverTimestamp()});
};

// Readiness collection — readiness/{uid}
const updateReadiness = async (uid,allHistory,subjects=[]) => {
  const today=new Date().toISOString().split("T")[0];
  const daysToExam=getDaysToExam();
  const subjectScores={};
  subjects.forEach(sub=>{
    const h=allHistory.filter(x=>x.subject===sub);
    if(h.length)subjectScores[sub]=Math.round(h.reduce((s,x)=>s+x.pct,0)/h.length);
  });
  const recent=allHistory.slice(-10);
  const overallScore=recent.length?Math.round(recent.reduce((s,h)=>s+h.pct,0)/recent.length):0;
  const predictedGrade=numToGrade(overallScore);
  const recent5=allHistory.slice(-5).map(h=>h.pct);
  const older5=allHistory.slice(-10,-5).map(h=>h.pct);
  const recentAvg=recent5.length?recent5.reduce((a,b)=>a+b,0)/recent5.length:overallScore;
  const olderAvg=older5.length?older5.reduce((a,b)=>a+b,0)/older5.length:overallScore;
  const trend=recentAvg-olderAvg;
  const projectedScore=Math.min(100,Math.round(overallScore+(trend*0.5)));
  const ref=doc(db,"readiness",uid);
  const snap=await getDoc(ref);
  const ex=snap.exists()?snap.data():{readinessHistory:[]};
  const readinessHistory=[...(ex.readinessHistory||[]),{date:today,score:overallScore}].slice(-30);
  await setDoc(ref,{overallScore,predictedGrade,subjectScores,readinessHistory,daysToExam,projectedScoreOnExamDay:projectedScore,lastUpdated:serverTimestamp()});
};
const checkDailyLimit = async (uid,isPremium) => {
  if(isPremium)return{allowed:true,remaining:Infinity};
  const today=new Date().toDateString();
  const snap=await getDoc(doc(db,"users",uid));const d=snap.data();
  if(d.lastActiveDate!==today){
    // Only write if counter needs resetting — avoids wasted write when already 0
    if((d.questionsToday||0)>0){await updateDoc(doc(db,"users",uid),{questionsToday:0,lastActiveDate:today});}
    return{allowed:true,remaining:FREE_DAILY_LIMIT};
  }
  const used=d.questionsToday||0;return{allowed:used<FREE_DAILY_LIMIT,remaining:Math.max(0,FREE_DAILY_LIMIT-used)};
};
const mapErr = code => ({
  "auth/email-already-in-use":"An account with this email already exists.",
  "auth/invalid-email":"That email doesn't look right.",
  "auth/wrong-password":"Incorrect password.",
  "auth/user-not-found":"No account with this email. Sign up instead.",
  "auth/invalid-credential":"Incorrect email or password.",
  "auth/too-many-requests":"Too many attempts. Wait a moment.",
  "auth/weak-password":"Password needs at least 6 characters.",
  "auth/network-request-failed":"No internet. Check your connection.",
})[code]||"Something went wrong. Try again.";

// ─── SHARE CARD COMPONENT ─────────────────────────────────────────────────────
function CrediQShareCard({grade="A",score=38,total=50,subject="Physics",year="2024",username="Student"}) {
  const cfg=GRADE_CONFIG[grade]||GRADE_CONFIG["A"];
  const acc=Math.round((score/total)*100);
  return (
    <div style={{width:"100%",aspectRatio:"1/1",position:"relative",overflow:"hidden",fontFamily:"'Playfair Display',serif",
      background:`radial-gradient(ellipse 80% 60% at 30% 55%,rgba(${cfg.glowRgb},0.13) 0%,transparent 65%),linear-gradient(160deg,${cfg.bgBase} 0%,${cfg.bgMid} 40%,${cfg.bgBase} 100%)`}}>
      <div style={{position:"absolute",inset:0,backgroundImage:`linear-gradient(rgba(184,151,62,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(184,151,62,0.04) 1px,transparent 1px)`,backgroundSize:"54px 54px",pointerEvents:"none"}}/>
      <div style={{position:"absolute",inset:0,border:`1px solid rgba(${cfg.glowRgb},0.15)`,pointerEvents:"none"}}/>
      <div style={{position:"relative",zIndex:2,width:"100%",height:"100%",display:"flex",flexDirection:"column",padding:"7%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"4%"}}>
          <div style={{display:"flex",alignItems:"baseline"}}><span style={{fontFamily:"'Playfair Display',serif",fontWeight:900,fontSize:"clamp(16px,4vw,30px)",color:"#F7F3EC"}}>Cred</span><span style={{fontFamily:"'Playfair Display',serif",fontWeight:900,fontSize:"clamp(16px,4vw,30px)",color:"#B8973E"}}>iq</span></div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"clamp(6px,1.4vw,11px)",color:cfg.gradeColor,background:`rgba(${cfg.glowRgb},0.08)`,border:`1px solid rgba(${cfg.glowRgb},0.25)`,padding:"4px 10px",borderRadius:100,fontWeight:700}}>{cfg.label}</div>
        </div>
        <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center"}}>
          <div style={{position:"relative",marginBottom:"2%"}}>
            <div style={{position:"absolute",left:"-3%",top:"-10%",fontFamily:"'Playfair Display',serif",fontWeight:900,fontSize:"clamp(100px,35vw,380px)",color:cfg.gradeColor,opacity:0.04,lineHeight:0.85,pointerEvents:"none"}}>{grade}</div>
            <div style={{position:"absolute",left:"0%",top:"50%",transform:"translateY(-50%)",width:"50%",aspectRatio:"1",background:`radial-gradient(circle,rgba(${cfg.glowRgb},0.18) 0%,transparent 70%)`,pointerEvents:"none"}}/>
            <div style={{fontFamily:"'Playfair Display',serif",fontWeight:900,fontSize:"clamp(70px,24vw,260px)",color:cfg.gradeColor,lineHeight:0.85,letterSpacing:"-0.04em",position:"relative",textShadow:`0 0 60px rgba(${cfg.glowRgb},0.3)`}}>{grade}</div>
          </div>
          <div style={{width:"clamp(40px,10%,70px)",height:2,background:`linear-gradient(90deg,${cfg.gradeColor},transparent)`,marginBottom:"clamp(8px,2.5%,18px)"}}/>
          <div style={{fontFamily:"'Playfair Display',serif",fontWeight:700,fontSize:"clamp(16px,5vw,50px)",color:"rgba(247,243,236,0.95)",lineHeight:1,marginBottom:"clamp(4px,1.5%,10px)"}}>{score}/{total} correct</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"clamp(11px,3vw,32px)",color:cfg.gradeColor,marginBottom:"clamp(4px,1.5%,12px)"}}>{acc}% accuracy</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:"clamp(8px,2vw,20px)",fontStyle:"italic",color:"rgba(247,243,236,0.35)"}}>{cfg.tagline}</div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
          <div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"clamp(6px,1.6vw,14px)",color:"rgba(247,243,236,0.5)",letterSpacing:"0.12em",textTransform:"uppercase"}}>{subject} · {year}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"clamp(5px,1.2vw,10px)",color:"rgba(247,243,236,0.25)",textTransform:"uppercase"}}>JUPEB Exam Readiness</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:"clamp(8px,1.8vw,16px)",color:"rgba(247,243,236,0.4)",fontStyle:"italic"}}>{username}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"clamp(5px,1vw,9px)",color:"rgba(184,151,62,0.3)",letterSpacing:"0.15em"}}>crediq.app</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const buildCSS = T => `
  /* ── Design Tokens ─────────────────────────────────────────────────────── */
  :root {
    --sp1:4px;  --sp2:8px;   --sp3:12px;  --sp4:16px;
    --sp5:20px; --sp6:24px;  --sp8:32px;  --sp10:40px; --sp12:48px;
    --tx-xs:11px; --tx-sm:12px; --tx-base:15px;
    --tx-lg:20px; --tx-xl:28px; --tx-2xl:40px; --tx-hero:72px;
    --r-sm:8px; --r-md:12px; --r-lg:16px; --r-full:100px;
    --ease-spring:cubic-bezier(0.34,1.56,0.64,1);
    --ease-out:cubic-bezier(0.16,1,0.3,1);
    --dur-fast:120ms; --dur-base:240ms; --dur-slow:400ms;
    --shadow-gold:0 8px 32px rgba(184,151,62,0.22);
    --shadow-up:0 -4px 24px rgba(0,0,0,0.3);
  }

  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html{width:100%;height:100%;}
  body{font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased;overscroll-behavior:none;background:${T.bg};color:${T.text};-webkit-tap-highlight-color:transparent;width:100%;min-height:100dvh;font-size:15px;line-height:1.5;}
  #root{width:100%;min-height:100dvh;overflow-x:hidden;}
  input,textarea,select{color:${T.text};font-family:inherit;}
  ::-webkit-scrollbar{width:3px;} ::-webkit-scrollbar-track{background:transparent;} ::-webkit-scrollbar-thumb{background:${T.border};border-radius:2px;}
  input[type="email"],input[type="text"],input[type="password"]{font-size:16px!important;}

  /* ── Keyframes ──────────────────────────────────────────────────────────── */
  @keyframes fadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
  @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
  @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
  @keyframes screenIn{from{opacity:0.01;transform:translateY(5px);}to{opacity:1;transform:translateY(0);}}
  @keyframes slideRight{from{transform:scaleX(0);}to{transform:scaleX(1);}}
  @keyframes slideUp{from{opacity:0;transform:translateY(100%);}to{opacity:1;transform:translateY(0);}}
  @keyframes slideDown{from{opacity:0;transform:translateY(-12px);}to{opacity:1;transform:translateY(0);}}
  @keyframes confirmSlide{from{opacity:0;transform:translateY(100%);}to{opacity:1;transform:translateY(0);}}
  @keyframes shake{0%,100%{transform:translateX(0);}20%,60%{transform:translateX(-4px);}40%,80%{transform:translateX(4px);}}
  @keyframes timerPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.02);}}
  @keyframes timerUrgent{0%,100%{transform:scale(1);opacity:1;}50%{transform:scale(1.04);opacity:0.8;}}
  @keyframes gradeReveal{from{opacity:0;transform:scale(0.65);}to{opacity:1;transform:scale(1);}}
  @keyframes gradeGlow{0%,100%{text-shadow:none;}50%{text-shadow:0 0 60px currentColor;}}
  @keyframes bounce{0%,100%{transform:scale(1);}30%{transform:scale(1.07);}60%{transform:scale(0.97);}}
  @keyframes questionSlide{from{opacity:0;transform:translateX(20px);}to{opacity:1;transform:translateX(0);}}
  @keyframes shimmer{0%{background-position:-300% 0;}100%{background-position:300% 0;}}
  @keyframes toastIn{from{opacity:0;transform:translateY(16px) scale(0.96);}to{opacity:1;transform:translateY(0) scale(1);}}
  @keyframes toastOut{from{opacity:1;}to{opacity:0;transform:translateY(8px) scale(0.96);}}
  @keyframes blink{0%,100%{opacity:1;}50%{opacity:0.25;}}
  @keyframes ring{from{stroke-dashoffset:283;}to{stroke-dashoffset:var(--target);}}
  @keyframes logoReveal{from{opacity:0;transform:scale(0.85) translateY(10px);}to{opacity:1;transform:scale(1) translateY(0);}}
  @keyframes taglineReveal{from{opacity:0;letter-spacing:0.5em;}to{opacity:1;letter-spacing:0.25em;}}
  @keyframes msgFade{0%,100%{opacity:0;}20%,80%{opacity:1;}}
  @keyframes float{0%,100%{transform:translateY(0);}50%{transform:translateY(-4px);}}
  @keyframes navPop{from{width:0;opacity:0;}to{width:16px;opacity:1;}}
  @keyframes springIn{from{opacity:0;transform:scale(0.92) translateY(8px);}to{opacity:1;transform:scale(1) translateY(0);}}
  @keyframes scoreReveal{from{opacity:0;transform:scale(0.8) translateY(10px);}to{opacity:1;transform:scale(1) translateY(0);}}
  .score-hero{animation:scoreReveal 0.6s 0.15s cubic-bezier(0.16,1,0.3,1) both;}
  .fi1{animation:fadeUp 0.25s 0.05s ease-out both;}
  .fi2{animation:fadeUp 0.25s 0.1s ease-out both;}
  .fi3{animation:fadeUp 0.25s 0.15s ease-out both;}
  .fi4{animation:fadeUp 0.25s 0.2s ease-out both;}
  .fi5{animation:fadeUp 0.25s 0.25s ease-out both;}

  /* ── Utility ────────────────────────────────────────────────────────────── */
  .screen-enter{animation:screenIn .2s ease-out forwards;will-change:opacity,transform;}
  .grade-reveal-a{animation:gradeReveal .6s .1s cubic-bezier(.16,1,.3,1) both,gradeGlow 1.4s .7s ease both;}
  .grade-reveal-b,.grade-reveal{animation:gradeReveal .5s .1s cubic-bezier(.16,1,.3,1) both;}
  .grade-reveal-f{animation:fadeIn .4s ease both;}
  .input-shake{animation:shake .3s ease both;}
  .timer-pulse{animation:timerPulse 2s ease-in-out infinite;}
  .timer-fast{animation:timerPulse .7s ease-in-out infinite;}
  .timer-urgent{animation:timerUrgent .5s ease-in-out infinite;}
  .answer-bounce{animation:bounce .28s cubic-bezier(.16,1,.3,1);}
  .question-enter{animation:questionSlide .2s cubic-bezier(.16,1,.3,1) both;}
  .confirm-slide{animation:confirmSlide .32s cubic-bezier(.16,1,.3,1) both;}
  .slide-down{animation:slideDown .28s cubic-bezier(.16,1,.3,1) both;}
  .toast-in{animation:toastIn .28s cubic-bezier(.16,1,.3,1) both;}
  .toast-out{animation:toastOut .22s ease both;}
  .skeleton{background:linear-gradient(90deg,${T.surface} 20%,${T.surface2} 50%,${T.surface} 80%);background-size:300% 100%;animation:shimmer 1.6s ease-in-out infinite;}
  .fi1{animation:fadeUp .5s .05s cubic-bezier(.16,1,.3,1) both;}
  .fi2{animation:fadeUp .5s .12s cubic-bezier(.16,1,.3,1) both;}
  .fi3{animation:fadeUp .5s .20s cubic-bezier(.16,1,.3,1) both;}
  .fi4{animation:fadeUp .5s .30s cubic-bezier(.16,1,.3,1) both;}
  .fi5{animation:fadeUp .5s .40s cubic-bezier(.16,1,.3,1) both;}
  .fi0{animation:fadeIn .5s ease both;}
  .line-in{animation:slideRight .7s .85s cubic-bezier(.16,1,.3,1) both;transform-origin:left center;}
  .slide-up{animation:slideUp .38s cubic-bezier(.16,1,.3,1) both;}
  .splash-logo{animation:logoReveal .8s .2s cubic-bezier(.16,1,.3,1) both;}
  .splash-tag{animation:taglineReveal .8s 1.1s ease both;}
  .float{animation:float 3s ease-in-out infinite;}
  .spring-in{animation:springIn .4s cubic-bezier(.16,1,.3,1) both;}

  /* ── Spring press (physical button feel) ───────────────────────────────── */
  .btn-press{
    transition:transform 80ms cubic-bezier(0.34,1.56,0.64,1);
    cursor:pointer;
    -webkit-tap-highlight-color:transparent;
  }
  .btn-press:active{
    transform:scale(0.94);
    transition:transform 55ms ease-in;
  }

  /* ── Backdrop blur for modals (Liquid Glass effect) ────────────────────── */
  .modal-overlay{
    background:rgba(10,20,16,0.75);
    backdrop-filter:blur(20px) saturate(160%);
    -webkit-backdrop-filter:blur(20px) saturate(160%);
  }
  .modal-overlay-dark{
    background:rgba(0,0,0,0.8);
    backdrop-filter:blur(18px) saturate(140%);
    -webkit-backdrop-filter:blur(18px) saturate(140%);
  }

  /* ── Content visibility (performance on low-end Android) ───────────────── */
  .offscreen{content-visibility:auto;contain-intrinsic-size:0 320px;}

  /* ── Exam progress track ────────────────────────────────────────────────── */
  .exam-prog-track{height:4px;background:rgba(255,255,255,0.06);width:100%;}
  .exam-prog-fill{
    height:100%;
    background:linear-gradient(90deg,${T.gold},${T.gold2});
    border-radius:0 3px 3px 0;
    transition:width 300ms cubic-bezier(.16,1,.3,1);
  }

  /* ── Nav active indicator ────────────────────────────────────────────────── */
  .nav-dot{height:2px;border-radius:1px;background:${T.gold};transition:width 260ms cubic-bezier(.16,1,.3,1),opacity 260ms ease;}

  /* ── Responsive layout system ───────────────────────────────────────────── */

  /* Tablet (600px–1023px): full width, no phone frame */
  @media (min-width:600px){
    body{background:${T.bg2};}
    #root{max-width:100%;box-shadow:none;border-radius:0;}
    .cq-content-wrap{max-width:100%;width:100%;}
    .resp-2{display:grid !important;grid-template-columns:1fr 1fr;gap:14px;}
    .resp-3{display:grid !important;grid-template-columns:1fr 1fr;gap:14px;}
  }

  /* Desktop (1024px+): sidebar navigation */
  @media (min-width:900px){
    body{background:${T.bg2};}
    #root{max-width:100%;display:flex;align-items:stretch;}
    .cq-sidebar{display:flex !important;}
    .cq-bottom-nav{display:none !important;}
    .cq-main{margin-left:240px;flex:1;min-height:100dvh;}
    /* Screens fill full available width — each screen manages its own content width */
    .cq-content-wrap{max-width:100%;width:100%;}
    .resp-2{grid-template-columns:1fr 1fr;gap:16px;}
    .resp-3{grid-template-columns:1fr 1fr 1fr;gap:16px;}
    /* Auth: centered card */
    .auth-wrap{display:flex;align-items:center;justify-content:center;min-height:100dvh;background:${T.bg2};}
    .auth-card{width:100%;max-width:460px;background:${T.surface};border:1px solid ${T.border};border-radius:20px;padding:44px;}
    /* Setup: 2-col grids */
    .setup-subjects-grid{display:grid !important;grid-template-columns:1fr 1fr;gap:10px;}
    .setup-modes-grid{display:grid !important;grid-template-columns:1fr 1fr;gap:10px;}
    /* Landing: 2-column hero */
    .landing-grid{display:grid !important;grid-template-columns:1fr 1fr;min-height:calc(100dvh - 60px);}
    .landing-right{display:flex !important;}
    /* Hide header theme toggle — sidebar handles it */
    .cq-main .theme-btn-header{display:none !important;}
    /* Dashboard desktop 2-column grid */
    .cq-dash-outer{max-width:1100px !important;padding:24px 32px 0 !important;}
    .cq-dash-grid{display:grid !important;grid-template-columns:1.3fr 1fr;gap:24px;align-items:start;}
    .cq-dash-col{min-width:0;}
    /* Exam readability cap */
    .exam-inner{max-width:860px;margin:0 auto;width:100%;padding:0 32px;}
  }

  /* Wide desktop (1280px+) */
  @media (min-width:1280px){
    .cq-main{margin-left:260px;}
    .cq-sidebar{width:260px !important;}
  }

  /* ── Sidebar nav (hidden on mobile/tablet) ───────────────────────────────── */
  .cq-sidebar{
    display:none;
    width:240px;
    min-height:100dvh;
    position:fixed;
    left:0;top:0;
    background:${T.navBg};
    border-right:1px solid ${T.navBorder};
    z-index:100;
    flex-direction:column;
    padding:28px 0 24px;
    overflow-y:auto;
  }
  .cq-sidebar-item{
    display:flex;
    align-items:center;
    gap:12px;
    padding:13px 24px;
    cursor:pointer;
    border:none;
    background:none;
    width:100%;
    text-align:left;
    transition:background 0.15s;
    border-left:3px solid transparent;
    -webkit-tap-highlight-color:transparent;
  }
  .cq-sidebar-item:hover{background:rgba(184,151,62,0.07);}
  .cq-sidebar-item.active{
    background:rgba(184,151,62,0.1);
    border-left-color:${T.gold};
  }
  .cq-sidebar-item.active span{color:${T.gold};}
  .cq-sidebar-item svg{flex-shrink:0;}
`;

// ─── RESPONSIVE HOOK — JS-based, always works regardless of CSS ───────────────
function useIsDesktop(breakpoint=900) {
  const [isDesktop,setIsDesktop]=useState(()=>typeof window!=="undefined"&&window.innerWidth>=breakpoint);
  useEffect(()=>{
    const fn=()=>setIsDesktop(window.innerWidth>=breakpoint);
    window.addEventListener("resize",fn);
    return()=>window.removeEventListener("resize",fn);
  },[breakpoint]);
  return isDesktop;
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function useToast() {
  const [toasts,setToasts]=useState([]);
  const show=useCallback((msg,type="info",dur=3000)=>{
    const id=Date.now();
    setToasts(t=>[...t,{id,msg,type,leaving:false}]);
    setTimeout(()=>{setToasts(t=>t.map(x=>x.id===id?{...x,leaving:true}:x));setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),300);},dur);
  },[]);
  return{toasts,show};
}
function ToastContainer({toasts}) {
  return (
    <div style={{position:"fixed",bottom:90,left:16,right:16,zIndex:400,display:"flex",flexDirection:"column",gap:8,pointerEvents:"none"}}>
      {toasts.map(t=>(
        <div key={t.id} className={t.leaving?"toast-out":"toast-in"} style={{background:t.type==="success"?"#1B3A2A":t.type==="error"?"rgba(192,57,43,0.95)":"rgba(15,34,24,0.95)",border:`1px solid ${t.type==="success"?"rgba(74,222,128,0.3)":t.type==="error"?"rgba(192,57,43,0.5)":"rgba(184,151,62,0.3)"}`,borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:10,boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}>
          {t.type==="success"&&<CheckCircle size={16} color="#4ade80"/>}
          {t.type==="error"&&<AlertCircle size={16} color="#ef4444"/>}
          {t.type==="info"&&<AlertTriangle size={16} color="#B8973E"/>}
          <span style={{fontSize:13,color:"#F7F3EC",flex:1}}>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ─── OFFLINE BANNER ───────────────────────────────────────────────────────────
function OfflineBanner() {
  const [offline,setOffline]=useState(!navigator.onLine);
  useEffect(()=>{
    const on=()=>setOffline(false),off=()=>setOffline(true);
    window.addEventListener("online",on);window.addEventListener("offline",off);
    return()=>{window.removeEventListener("online",on);window.removeEventListener("offline",off);};
  },[]);
  if(!offline)return null;
  return (
    <div className="slide-down" style={{position:"fixed",top:0,left:0,right:0,zIndex:600,background:"rgba(192,57,43,0.97)",padding:"10px 16px",display:"flex",alignItems:"center",gap:8}}>
      <WifiOff size={14} color="#fff"/><span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#fff",letterSpacing:"0.08em"}}>NO INTERNET — changes will save when you're back online</span>
    </div>
  );
}

// ─── WHATSAPP SUPPORT BUTTON ──────────────────────────────────────────────────
// ─── LOADING SCREEN (rotating messages) ──────────────────────────────────────
function LoadingScreen() {
  const [msgIdx,setMsgIdx]=useState(0);
  useEffect(()=>{const t=setInterval(()=>setMsgIdx(i=>(i+1)%SPLASH_MESSAGES.length),1800);return()=>clearInterval(t);},[]);
  return (
    <div style={{minHeight:"100dvh",background:"linear-gradient(160deg,#020D08 0%,#040F0A 30%,#071510 60%,#030A07 100%)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:"linear-gradient(rgba(184,151,62,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(184,151,62,0.03) 1px,transparent 1px)",backgroundSize:"54px 54px"}}/>
      <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 60% 50% at 50% 42%,rgba(184,151,62,0.07) 0%,transparent 70%)"}}/>
      {/* Nudge the whole block ~8vh above mathematical center — that's where eyes read "center" */}
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginTop:"-8vh"}}>
        <div className="splash-logo" style={{textAlign:"center",marginBottom:18}}>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"center"}}>
            <span style={{fontFamily:"'Playfair Display',serif",fontSize:54,fontWeight:900,color:"#F7F3EC",letterSpacing:"-0.03em"}}>Cred</span>
            <span style={{fontFamily:"'Playfair Display',serif",fontSize:54,fontWeight:900,color:"#B8973E",letterSpacing:"-0.03em"}}>iq</span>
          </div>
        </div>
        <div style={{width:60,height:1,background:"linear-gradient(90deg,transparent,#B8973E,transparent)",marginBottom:18}}/>
        <div className="splash-tag" style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.55)",letterSpacing:"0.25em",marginBottom:36}}>KNOW IF YOU'RE READY.</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(247,243,236,0.4)",letterSpacing:"0.08em",marginBottom:18,height:18,textAlign:"center"}} key={msgIdx}>
          {SPLASH_MESSAGES[msgIdx]}
        </div>
        <div style={{display:"flex",gap:7}}>
          {[0,1,2].map(i=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:"rgba(184,151,62,0.45)",animation:`blink 1.2s ${i*0.22}s ease-in-out infinite`}}/>)}
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD SKELETON ───────────────────────────────────────────────────────
function DashboardSkeleton({T}) {
  return (
    <div style={{minHeight:"100dvh",background:T.bg,paddingBottom:80}}>
      <div style={{background:T.navBg,padding:"20px 20px 16px",borderBottom:`1px solid ${T.navBorder}`}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
          <div className="skeleton" style={{width:80,height:22,borderRadius:4}}/>
          <div className="skeleton" style={{width:60,height:24,borderRadius:12}}/>
        </div>
        <div className="skeleton" style={{width:140,height:13,borderRadius:4}}/>
      </div>
      <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
        <div className="skeleton" style={{height:110,borderRadius:12}}/>
        <div className="skeleton" style={{height:36,borderRadius:8}}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
          <div className="skeleton" style={{height:90,borderRadius:10}}/>
          <div className="skeleton" style={{height:90,borderRadius:10}}/>
        </div>
        <div className="skeleton" style={{height:70,borderRadius:9}}/>
        <div className="skeleton" style={{height:70,borderRadius:9}}/>
        <div className="skeleton" style={{height:70,borderRadius:9}}/>
      </div>
    </div>
  );
}

// ─── SESSION MISMATCH MODAL ───────────────────────────────────────────────────
function SessionMismatchModal({onContinue,onLogout,T}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:500,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div className="screen-enter" style={{background:T.navBg,borderRadius:16,padding:"28px 24px",width:"100%",maxWidth:360,border:`1px solid rgba(249,115,22,0.3)`}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <Shield size={32} color="#f97316" style={{margin:"0 auto 12px"}}/>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:T.text,marginBottom:8}}>Account opened elsewhere</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,lineHeight:1.7}}>Your account was opened on another device. Continue here to take over this session.</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button className="btn-press" onClick={onContinue} style={{width:"100%",padding:"14px 0",border:"none",borderRadius:10,background:"linear-gradient(135deg,#004B3B,#8A6A1E)",color:"#F7F3EC",fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,cursor:"pointer"}}>Continue Here</button>
          <button className="btn-press" onClick={onLogout} style={{width:"100%",padding:"12px 0",border:`1px solid ${T.border}`,borderRadius:10,background:"transparent",color:T.muted,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer",letterSpacing:"0.08em"}}>LOG OUT INSTEAD</button>
        </div>
      </div>
    </div>
  );
}

// ─── MASTERY RING ─────────────────────────────────────────────────────────────
function MasteryRing({pct,color,size=44}) {
  const r=16,circ=2*Math.PI*r,offset=circ-(pct/100)*circ;
  return (
    <svg width={size} height={size} viewBox="0 0 44 44">
      <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4"/>
      <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform="rotate(-90 22 22)" style={{transition:"stroke-dashoffset 1s ease"}}/>
      <text x="22" y="26" textAnchor="middle" fill={color} style={{fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700}}>{pct}%</text>
    </svg>
  );
}

// ─── TREND CHART (simple bar chart) ──────────────────────────────────────────
function TrendChart({data,T}) {
  if(!data.length)return null;
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:4,height:64}}>
      {data.map((h,i)=>{
        const g=grade(h.pct);const gc=gradeColor(g,T);
        const ht=Math.max(4,(h.pct/100)*56);
        return (
          <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
            <div style={{width:"100%",background:gc,borderRadius:"3px 3px 0 0",height:`${ht}px`,minHeight:4,transition:"height .5s"}}/>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{g}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── REPORT QUESTION MODAL ────────────────────────────────────────────────────
function ReportModal({question,user,onClose,onSubmit,T}) {
  const [reason,setReason]=useState("");
  const [note,setNote]=useState("");
  const [submitted,setSubmitted]=useState(false);
  const [loading,setLoading]=useState(false);
  const reasons=[
    "Missing diagram or image",
    "Wrong answer key",
    "Question has errors or typo",
    "Unclear or incomplete question",
    "Duplicate question",
    "Out of JUPEB syllabus",
    "Other",
  ];
  const submit=async()=>{
    if(!reason||loading)return;
    setLoading(true);
    try{
      await addDoc(collection(db,"reports"),{
        questionId:question?.id||"unknown",
        questionText:question?.question||question?.q||"",
        subject:question?.subject||"",
        topic:question?.topic||"",
        reason,
        note:note||"",
        reportedBy:user?.uid||"anonymous",
        reporterEmail:user?.email||"",
        createdAt:Date.now(),
        status:"pending",
      });
      // Increment report count on the question document
      if(question?.id){
        try{
          await updateDoc(doc(db,"questions",question.id),{reports:increment(1)});
        }catch{}
      }
      track("question_reported",{uid:user?.uid,reason});
    }catch(e){console.error("Report failed:",e);}
    setSubmitted(true);
    onSubmit&&onSubmit({reason,note});
    setTimeout(onClose,2000);
    setLoading(false);
  };
  return (
    <div className="modal-overlay-dark" style={{position:"fixed",inset:0,zIndex:300,display:"flex",alignItems:"flex-end"}}>
      <div className="confirm-slide" style={{width:"100%",background:T.navBg,borderRadius:"20px 20px 0 0",padding:"24px 20px 40px",border:`1px solid ${T.navBorder}`,borderBottom:"none",maxHeight:"80vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.text}}>Report Question</div>
          <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:T.muted}}><X size={18}/></button>
        </div>
        {submitted?(
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <CheckCircle size={40} color="#4ade80" style={{margin:"0 auto 12px"}}/>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:700,color:T.text,marginBottom:6}}>Report submitted</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Thank you. We'll review and fix this.</div>
          </div>
        ):(
          <>
            {question?.question&&<div style={{fontSize:12,color:T.muted,lineHeight:1.5,marginBottom:16,padding:"10px 12px",background:T.surface,borderRadius:8}}>{(question.question||"").slice(0,120)}...</div>}
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,letterSpacing:"0.12em",marginBottom:10}}>WHAT IS THE ISSUE?</div>
            <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:16}}>
              {reasons.map(r=>(
                <div key={r} className="btn-press" onClick={()=>setReason(r)}
                  style={{padding:"12px 14px",background:reason===r?"rgba(184,151,62,0.12)":T.surface,
                    border:`1px solid ${reason===r?T.gold:T.border}`,borderRadius:8,cursor:"pointer",
                    display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:13,color:T.text}}>{r}</span>
                  {reason===r&&<CheckCircle size={14} color={T.gold}/>}
                </div>
              ))}
            </div>
            {(reason==="Other"||reason==="Question has errors or typo")&&(
              <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Describe the issue..." rows={3}
                style={{width:"100%",background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 12px",color:T.text,fontSize:13,resize:"none",outline:"none",marginBottom:16}}/>
            )}
            <button className="btn-press" onClick={submit} disabled={!reason||loading}
              style={{width:"100%",padding:"14px 0",border:"none",borderRadius:10,
                background:reason?"linear-gradient(135deg,#004B3B,#8A6A1E)":`${T.muted}44`,
                color:reason?"#F7F3EC":T.muted,fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,
                cursor:reason?"pointer":"not-allowed"}}>
              {loading?"Submitting...":"Submit Report"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── CONFIRM QUIT ─────────────────────────────────────────────────────────────
function ConfirmQuit({onConfirm,onCancel,answered,total,T}) {
  return (
    <div className="modal-overlay" style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"flex-end"}}>
      <div className="confirm-slide" style={{width:"100%",background:T.navBg,borderRadius:"20px 20px 0 0",padding:"24px 20px 40px",border:`1px solid ${T.navBorder}`,borderBottom:"none"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <AlertTriangle size={28} color={T.warn} style={{margin:"0 auto 10px"}}/>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:T.text,marginBottom:6}}>Quit this session?</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,lineHeight:1.7}}>{total-answered} question{total-answered!==1?"s":""} unanswered.<br/>This session will not be saved.</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button className="btn-press" onClick={onCancel} style={{width:"100%",padding:"14px 0",border:"none",borderRadius:10,background:"linear-gradient(135deg,#004B3B,#8A6A1E)",color:"#F7F3EC",fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,cursor:"pointer"}}>Keep Going</button>
          <button className="btn-press" onClick={onConfirm} style={{width:"100%",padding:"12px 0",border:"1px solid rgba(192,57,43,0.4)",borderRadius:10,background:"rgba(192,57,43,0.08)",color:"#C0392B",fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer",letterSpacing:"0.08em"}}>QUIT WITHOUT SAVING</button>
        </div>
      </div>
    </div>
  );
}

// ─── PREMIUM GATE ─────────────────────────────────────────────────────────────
function PremiumGate({user,onClose,onGoToWhyPremium,onUpgrade,onRestore,T}) {
  const today=new Date().toDateString();
  const usedToday=user?.lastActiveDate===today?(user?.questionsToday||0):0;
  return (
    <div className="modal-overlay" style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"flex-end"}}>
      <div className="slide-up spring-in" style={{width:"100%",background:"#0f2218",borderRadius:"20px 20px 0 0",padding:"28px 22px 40px",border:"1px solid rgba(184,151,62,0.25)",borderBottom:"none",boxShadow:"0 -8px 40px rgba(0,0,0,0.6)"}}>
        <button onClick={onClose} style={{position:"absolute",top:16,right:16,background:"none",border:"none",cursor:"pointer",color:"rgba(247,243,236,0.3)",padding:8}}><X size={18}/></button>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(184,151,62,0.5)",letterSpacing:"0.18em",marginBottom:10}}>{usedToday>0?`YOU PRACTICED ${usedToday} QUESTIONS TODAY`:"UNLOCK UNLIMITED PRACTICE"}</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:26,fontWeight:900,color:"#F7F3EC",lineHeight:1.1}}>Go unlimited.</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:400,color:"rgba(247,243,236,0.5)",fontStyle:"italic",marginTop:6,lineHeight:1.5}}>Every serious JUPEB student<br/>practices 100+ questions daily.</div>
        </div>
        <div style={{background:"rgba(184,151,62,0.07)",border:"1px solid rgba(184,151,62,0.18)",borderRadius:12,padding:"16px 18px",marginBottom:16}}>
          {["Unlimited questions every day until August","Full CBT simulations with real exam timing","All 4,413 questions — every JUPEB topic covered","Topic drills (001–004) for every weakness","Full score intelligence — see exactly why your grade is where it is"].map((f,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:i<4?10:0}}>
              <CheckCircle size={14} color="#4ade80" strokeWidth={2}/>
              <span style={{fontSize:13,color:"#F7F3EC",lineHeight:1.4}}>{f}</span>
            </div>
          ))}
        </div>
        <div style={{textAlign:"center",marginBottom:16}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:36,fontWeight:900,color:"#B8973E",lineHeight:1}}>₦2,500</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(247,243,236,0.4)",letterSpacing:"0.1em",marginTop:4}}>ONE-TIME · VALID UNTIL EXAM DAY</div>
        </div>
        <button className="btn-press" onClick={()=>{track("payment_started",{uid:user?.uid});onUpgrade&&onUpgrade();}} style={{width:"100%",padding:"16px 0",border:"none",borderRadius:10,background:"linear-gradient(135deg,#004B3B 0%,#1B3A2A 45%,#8A6A1E 100%)",color:"#F7F3EC",fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:700,cursor:"pointer",boxShadow:"0 8px 32px rgba(0,75,59,0.45)",marginBottom:10}}>
          Pay ₦2,500 — Unlock Everything
        </button>
        <button onClick={onGoToWhyPremium} style={{width:"100%",padding:"10px 0",border:"none",background:"transparent",color:"rgba(184,151,62,0.6)",fontFamily:"'DM Mono',monospace",fontSize:11,cursor:"pointer",letterSpacing:"0.08em"}}>
          WHY PREMIUM? SEE FULL BREAKDOWN →
        </button>
        {onRestore&&(
          <button onClick={onRestore} style={{width:"100%",padding:"10px 0",border:"none",background:"transparent",color:"rgba(74,222,128,0.5)",fontFamily:"'DM Mono',monospace",fontSize:11,cursor:"pointer",letterSpacing:"0.08em"}}>
            ALREADY PAID? RESTORE ACCESS →
          </button>
        )}
        <button onClick={onClose} style={{width:"100%",padding:"10px 0",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,background:"transparent",color:"rgba(247,243,236,0.25)",fontFamily:"'DM Mono',monospace",fontSize:11,cursor:"pointer",letterSpacing:"0.08em",marginTop:6}}>
          CONTINUE TOMORROW (RESETS AT MIDNIGHT)
        </button>
      </div>
    </div>
  );
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
function SubjectBadge({code,color,size=22}) {
  return (
    <div style={{width:size+6,height:size+6,borderRadius:6,background:`${color}20`,border:`1px solid ${color}40`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
      <span style={{fontFamily:"'DM Mono',monospace",fontSize:size*0.38,color,fontWeight:700}}>{code}</span>
    </div>
  );
}
function Logo({size=22,onDark=true}) {
  const c=onDark?"#F7F3EC":"#1B2E1F";
  return <div style={{display:"flex",alignItems:"baseline"}}><span style={{fontFamily:"'Playfair Display',serif",fontSize:size,fontWeight:900,color:c,letterSpacing:"-0.02em"}}>Cred</span><span style={{fontFamily:"'Playfair Display',serif",fontSize:size,fontWeight:900,color:"#B8973E",letterSpacing:"-0.02em"}}>iq</span></div>;
}
function ThemeBtn({dark,setDark,T}) {
  return <button className="btn-press theme-btn-header" onClick={()=>setDark(!dark)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:20,padding:"4px 10px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,display:"flex",alignItems:"center",gap:4}}>{dark?<><Sun size={9}/> LIGHT</>:<><Moon size={9}/> DARK</>}</button>;
}
function BtnPrimary({onClick,children,disabled,loading,T,style={}}) {
  return (
    <button className="btn-press" onClick={onClick} disabled={disabled||loading} style={{width:"100%",padding:"15px 0",border:"none",borderRadius:10,background:(disabled||loading)?`${T.muted}44`:"linear-gradient(135deg,#004B3B 0%,#1B3A2A 45%,#8A6A1E 100%)",color:(disabled||loading)?T.muted:"#F7F3EC",fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:700,cursor:(disabled||loading)?"not-allowed":"pointer",boxShadow:(disabled||loading)?"none":"0 6px 28px rgba(0,75,59,0.4)",opacity:(disabled||loading)?0.6:1,...style}}>
      {loading?"Please wait...":children}
    </button>
  );
}

// ─── BOTTOM NAV (5 tabs — mobile/tablet only) ─────────────────────────────
function BottomNav({active,onChange,T}) {
  const items=[
    {key:"dashboard",icon:<Home size={22}/>,label:"My Plan"},
    {key:"setup",icon:<Play size={22}/>,label:"CBT Practice"},
    {key:"drill",icon:<Target size={22}/>,label:"Fix It"},
    {key:"analytics",icon:<BarChart2 size={22}/>,label:"JUPEB Report"},
    {key:"profile",icon:<User size={22}/>,label:"Profile"},
  ];
  return (
    <nav className="cq-bottom-nav" style={{position:"fixed",bottom:0,left:0,right:0,background:T.navBg,borderTop:`1px solid ${T.navBorder}`,display:"flex",zIndex:100,paddingBottom:"env(safe-area-inset-bottom,0)"}}>
      {items.map(it=>{
        const on=active===it.key;
        return (
          <button key={it.key} className="btn-press" onClick={()=>onChange(it.key)}
            style={{flex:1,padding:"12px 0 10px",background:"none",border:"none",cursor:"pointer",
              display:"flex",flexDirection:"column",alignItems:"center",gap:3,
              color:on?T.gold:"rgba(247,243,236,0.28)",transition:"color .18s",minHeight:52}}>
            {it.icon}
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,letterSpacing:"0.06em",fontWeight:on?700:400}}>{it.label}</span>
            <div className="nav-dot" style={{width:on?16:0,opacity:on?1:0}}/>
          </button>
        );
      })}
    </nav>
  );
}

// ─── SIDE NAV (desktop only — 1024px+) ───────────────────────────────────────
function SideNav({active,onChange,user,dark,setDark,T,onUpgrade,onLogout,onProfile}) {
  const items=[
    {key:"dashboard",icon:<Home size={20}/>,label:"My Plan"},
    {key:"setup",    icon:<Play size={20}/>,label:"CBT Practice"},
    {key:"drill",    icon:<Target size={20}/>,label:"Fix Score Blockers",premium:true},
    {key:"analytics",icon:<BarChart2 size={20}/>,label:"JUPEB Report"},
  ];
  return (
    <aside className="cq-sidebar">
      {/* Logo */}
      <div style={{padding:"0 24px 28px"}}>
        <Logo size={22} onDark={dark}/>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginTop:4}}>JUPEB 2026 PREP</div>
      </div>

      {/* Nav items */}
      <div style={{flex:1,overflowY:"auto"}}>
        {items.map(it=>{
          const on=active===it.key;
          const locked=it.premium&&!user?.isPremium;
          return (
            <button key={it.key} className={`cq-sidebar-item${on?" active":""}`} onClick={()=>onChange(it.key)}>
              <span style={{color:on?T.gold:locked?"rgba(247,243,236,0.25)":"rgba(247,243,236,0.4)",display:"flex"}}>{it.icon}</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,letterSpacing:"0.06em",color:on?T.gold:locked?"rgba(247,243,236,0.3)":"rgba(247,243,236,0.55)",fontWeight:on?700:400,flex:1}}>{it.label}</span>
              {locked&&<Lock size={10} color="rgba(247,243,236,0.25)"/>}
            </button>
          );
        })}
      </div>

      {/* Bottom section */}
      <div style={{padding:"16px 16px 0",borderTop:`1px solid ${T.navBorder}`}}>

        {/* Upgrade CTA — free users only */}
        {user&&!user.isPremium&&(
          <button className="btn-press" onClick={onUpgrade} style={{width:"100%",padding:"10px 14px",marginBottom:12,border:"1px solid rgba(184,151,62,0.35)",borderRadius:9,background:"rgba(184,151,62,0.08)",cursor:"pointer",display:"flex",alignItems:"center",gap:8,textAlign:"left"}}>
            <span style={{fontSize:14}}>✦</span>
            <div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.gold,fontWeight:700,letterSpacing:"0.05em"}}>Upgrade to Premium</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"rgba(184,151,62,0.5)",marginTop:1}}>₦2,500 · Unlimited until Aug 14</div>
            </div>
          </button>
        )}
        {user&&user.isPremium&&(
          <div style={{padding:"8px 14px",marginBottom:12,border:"1px solid rgba(74,222,128,0.2)",borderRadius:9,background:"rgba(74,222,128,0.05)"}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#4ade80",letterSpacing:"0.08em"}}>✦ PREMIUM ACTIVE</div>
          </div>
        )}

        {/* User avatar — click to go to profile */}
        {user&&(
          <button className="btn-press" onClick={onProfile} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"10px 6px",background:"none",border:"none",cursor:"pointer",borderRadius:8,marginBottom:4}}>
            <div style={{width:34,height:34,borderRadius:"50%",background:`${T.gold}22`,border:`1px solid ${T.gold}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:T.gold}}>{(user.name||"?")[0].toUpperCase()}</span>
            </div>
            <div style={{overflow:"hidden",flex:1,textAlign:"left"}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.text,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{user.name?.split(" ")[0]||"Student"}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,marginTop:1}}>View profile →</div>
            </div>
          </button>
        )}

        {/* Theme + Logout row */}
        <div style={{display:"flex",gap:8,paddingBottom:16,marginTop:4}}>
          <ThemeBtn dark={dark} setDark={setDark} T={T}/>
          <button className="btn-press" onClick={onLogout} style={{flex:1,padding:"4px 10px",background:"none",border:`1px solid ${T.border}`,borderRadius:20,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.3)",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
            <LogOut size={9}/> LOG OUT
          </button>
        </div>

      </div>
    </aside>
  );
}

// ─── DAILY LIMIT PILL ─────────────────────────────────────────────────────────
function DailyLimitPill({user,T,onUpgrade}) {
  if(user?.isPremium)return null;
  const today=new Date().toDateString();
  const used=(user?.lastActiveDate===today)?(user?.questionsToday||0):0,rem=Math.max(0,FREE_DAILY_LIMIT-used);
  if(used===0)return null;
  const pct=(used/FREE_DAILY_LIMIT)*100,isLow=rem<=10,isOut=rem===0;
  return (
    <div onClick={isOut?onUpgrade:undefined} style={{background:isOut?"rgba(192,57,43,0.12)":isLow?"rgba(249,115,22,0.1)":"rgba(184,151,62,0.08)",border:`1px solid ${isOut?"rgba(192,57,43,0.3)":isLow?"rgba(249,115,22,0.3)":"rgba(184,151,62,0.2)"}`,borderRadius:8,padding:"8px 12px",cursor:isOut?"pointer":"default"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:isOut?"#C0392B":isLow?"#f97316":"#B8973E",letterSpacing:"0.1em"}}>
          {isOut?"You've hit today's limit. Upgrade to keep fixing →":"Plan mode · "+rem+" practice questions left today"}
        </span>
        {!isOut&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.3)"}}>Resets midnight</span>}
      </div>
      <div style={{height:3,background:`${T.muted}22`,borderRadius:2,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${Math.min(pct,100)}%`,background:isOut?"#C0392B":isLow?"#f97316":"#B8973E",borderRadius:2,transition:"width .5s"}}/>
      </div>
    </div>
  );
}

// ─── SOCIAL PROOF BAR ─────────────────────────────────────────────────────────
function SocialProofBar({T}) {
  return (
    <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
      {[
        {icon:<Users size={10} color={T.gold}/>,text:"2,341 students practicing"},
        {icon:<BookOpen size={10} color={T.success}/>,text:"583 mock exams today"},
        {icon:<Star size={10} color={T.warn}/>,text:"85 joined today"},
      ].map((s,i)=>(
        <div key={i} style={{flexShrink:0,display:"flex",alignItems:"center",gap:5,background:T.surface,border:`1px solid ${T.border}`,borderRadius:20,padding:"5px 10px"}}>
          {s.icon}<span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,whiteSpace:"nowrap"}}>{s.text}</span>
        </div>
      ))}
    </div>
  );
}

// ─── STREAK CARD ──────────────────────────────────────────────────────────────
function StreakCard({streak,T}) {
  const {count,studiedToday}=streak;
  if(count===0&&!studiedToday)return null;
  return (
    <div style={{background:count>=7?"rgba(249,115,22,0.12)":"rgba(184,151,62,0.08)",border:`1px solid ${count>=7?"rgba(249,115,22,0.3)":"rgba(184,151,62,0.2)"}`,borderRadius:8,padding:"10px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <Flame size={18} color={count>=7?"#f97316":"#B8973E"}/>
        <div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:700,color:count>=7?"#f97316":T.gold}}>{count}-day streak</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginTop:1}}>{studiedToday?"✓ Studied today":"Study today to keep your streak"}</div>
        </div>
      </div>
      {count>=3&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:count>=7?"#f97316":T.gold,background:count>=7?"rgba(249,115,22,0.1)":"rgba(184,151,62,0.1)",borderRadius:20,padding:"3px 8px"}}>{count>=14?"🔥 On fire":count>=7?"⚡ Strong":count>=3?"📈 Building":""}</div>}
    </div>
  );
}


// ─── LANDING SCREEN ───────────────────────────────────────────────────────────
function LandingScreen({onGetStarted,onLogin,T}) {
  const daysLeft=daysUntil("2026-08-03");
  const isDesktop=useIsDesktop(900);

  return (
    <div style={{minHeight:"100dvh",background:"linear-gradient(160deg,#020D08 0%,#061410 30%,#0A1C12 60%,#071009 100%)",color:"#F7F3EC",display:"flex",flexDirection:"column",overflow:"hidden",position:"relative"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:"linear-gradient(rgba(184,151,62,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(184,151,62,0.03) 1px,transparent 1px)",backgroundSize:"54px 54px",pointerEvents:"none"}}/>
      <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse 70% 55% at 50% 60%,rgba(27,58,42,0.45) 0%,transparent 70%)",pointerEvents:"none"}}/>

      {/* Top nav */}
      <div style={{position:"relative",padding:"18px 32px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(184,151,62,0.08)"}}>
        <Logo size={22} onDark={true}/>
        <button className="btn-press" onClick={onLogin} style={{padding:"8px 18px",border:"1px solid rgba(184,151,62,0.2)",borderRadius:100,background:"transparent",color:"rgba(247,243,236,0.5)",fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer",letterSpacing:"0.1em"}}>LOG IN</button>
      </div>

      {/* Body */}
      <div style={{position:"relative",flex:1,display:"grid",gridTemplateColumns:isDesktop?"1fr 1fr":"1fr",minHeight:isDesktop?"calc(100dvh - 60px)":"auto"}}>

        {/* LEFT: main content */}
        <div style={{display:"flex",flexDirection:"column",justifyContent:"center",padding:isDesktop?"48px 56px":"32px 28px 24px"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"6px 14px",border:"1px solid rgba(184,151,62,0.2)",borderRadius:100,marginBottom:28,alignSelf:"flex-start"}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.7)",letterSpacing:"0.16em"}}>JUPEB 2026 · YOUR EXAM GPS</span>
          </div>

          <div style={{marginBottom:20}}>
            {["Buy every textbook.","Wake up at 4am.","JUPEB is hard."].map((t,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:5}}>
                <div style={{width:12,height:1,background:"#C0392B",flexShrink:0}}/>
                <span style={{fontSize:13,color:"rgba(247,243,236,0.35)",textDecoration:"line-through",textDecorationColor:"rgba(192,57,43,0.5)"}}>{t}</span>
              </div>
            ))}
            <div style={{marginTop:8,fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.18)",letterSpacing:"0.12em"}}>WHAT EVERY SET BEFORE YOU WAS TOLD.</div>
          </div>

          <div style={{height:1,background:"linear-gradient(90deg,#B8973E,rgba(240,208,128,0.3),transparent)",marginBottom:24}}/>

          <div style={{marginBottom:24}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.45)",letterSpacing:"0.2em",marginBottom:12}}>YOUR EXAM GPS IS HERE.</div>
            <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:isDesktop?"52px":"clamp(32px,8vw,48px)",fontWeight:900,lineHeight:1.03,color:"#F7F3EC",marginBottom:4}}>Stop guessing.<br/>Know exactly</h1>
            <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:isDesktop?"34px":"clamp(22px,5.5vw,34px)",fontWeight:900,fontStyle:"italic",color:"#B8973E",lineHeight:1.1}}>what to study next.</h2>
          </div>

          <div style={{display:"flex",gap:8,marginBottom:28}}>
            {[["3,173","REAL QUESTIONS"],["2,341+","STUDENTS"],["FREE","TO START"]].map(([num,label],i)=>(
              <div key={i} style={{flex:1,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(184,151,62,0.12)",borderRadius:8,padding:"10px 6px",textAlign:"center"}}>
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:700,color:"#B8973E",marginBottom:2}}>{num}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"rgba(184,151,62,0.45)",letterSpacing:"0.08em"}}>{label}</div>
              </div>
            ))}
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:10,maxWidth:isDesktop?480:"100%"}}>
            <button className="btn-press" onClick={onGetStarted} style={{width:"100%",padding:"16px",border:"1px solid rgba(184,151,62,0.35)",borderRadius:12,background:"linear-gradient(135deg,#162B1E,#1F3D29)",color:"#B8973E",fontFamily:"'DM Mono',monospace",fontSize:11,letterSpacing:"0.14em",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
              BUILD MY PLAN FREE
              <div style={{width:22,height:22,borderRadius:"50%",background:"rgba(184,151,62,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>→</div>
            </button>
            <button className="btn-press" onClick={onLogin} style={{width:"100%",padding:"13px",border:"1px solid rgba(255,255,255,0.06)",borderRadius:12,background:"transparent",color:"rgba(247,243,236,0.28)",fontFamily:"'DM Mono',monospace",fontSize:10,letterSpacing:"0.1em",cursor:"pointer"}}>
              ALREADY HAVE AN ACCOUNT · LOG IN
            </button>
          </div>

          <div style={{marginTop:20,fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(192,57,43,0.5)",letterSpacing:"0.1em"}}>
            {daysLeft} DAYS UNTIL AUGUST 3 · EVERY DAY WITHOUT PRACTICE IS A RISK.
          </div>
        </div>

        {/* RIGHT: desktop only visual panel */}
        {isDesktop&&(
          <div style={{display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",padding:"40px 48px",borderLeft:"1px solid rgba(184,151,62,0.06)",background:"rgba(0,0,0,0.15)"}}>
            <div style={{textAlign:"center",marginBottom:40}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.4)",letterSpacing:"0.2em",marginBottom:8}}>TIME UNTIL FIRST EXAM</div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:110,fontWeight:900,color:"#B8973E",lineHeight:1,letterSpacing:"-4px"}}>{daysLeft}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"rgba(247,243,236,0.25)",letterSpacing:"0.2em",marginTop:4}}>DAYS</div>
            </div>
            <div style={{width:"100%",maxWidth:380}}>
              {[
                {icon:"⚡",title:"Know what to study tonight",sub:"CrediQ finds exactly where you're losing marks"},
                {icon:"🎯",title:"Stop wasting time on the wrong topics",sub:"Only drill the topics costing you marks"},
                {icon:"📈",title:"Proof you're improving",sub:"Every session moves your readiness up — visibly"},
                {icon:"🧠",title:"Never forget what you've learned",sub:"Memory reminders before it fades"},
              ].map((item,i)=>(
                <div key={i} style={{display:"flex",gap:14,alignItems:"flex-start",marginBottom:16,padding:"14px 16px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(184,151,62,0.1)",borderRadius:10}}>
                  <div style={{fontSize:20,flexShrink:0}}>{item.icon}</div>
                  <div>
                    <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,fontWeight:700,color:"#F7F3EC",marginBottom:3}}>{item.title}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"rgba(247,243,236,0.35)"}}>{item.sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.15)",letterSpacing:"0.1em",textAlign:"center",marginTop:8}}>FREE TO START · NO CARD REQUIRED</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
function AuthScreen({onAuth,dark,setDark,T}) {
  const [mode,setMode]=useState("login");
  const [email,setEmail]=useState("");
  const [pw,setPw]=useState("");
  const [name,setName]=useState("");
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [focused,setFocused]=useState(null);
  const [shaking,setShaking]=useState(false);
  const [touched,setTouched]=useState({});
  const [showPw,setShowPw]=useState(false);
  const [pendingVerify,setPendingVerify]=useState(null);
  const [verifying,setVerifying]=useState(false);
  const [resent,setResent]=useState(false);

  const getInline=f=>{
    if(!touched[f])return null;
    if(f==="name"&&mode==="signup"&&!name.trim())return "What should we call you?";
    if(f==="email"&&email&&!email.includes("@"))return "That doesn't look like an email.";
    if(f==="pw"&&pw&&pw.length<6)return "At least 6 characters.";
    return null;
  };
  const shake=msg=>{setErr(msg);setShaking(true);setTimeout(()=>setShaking(false),400);};
  const inp=f=>({width:"100%",background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"13px 16px",fontSize:16,outline:"none",color:"#F7F3EC",border:getInline(f)?"1px solid rgba(192,57,43,0.8)":focused===f?"1px solid rgba(184,151,62,0.55)":"1px solid rgba(184,151,62,0.22)",transition:"border .15s"});

  const handleSubmit=async()=>{
    setErr("");setShaking(false);
    if(mode==="signup"&&!name.trim()){shake("Enter your name.");return;}
    if(!email.includes("@")){shake("Enter a valid email.");return;}
    if(pw.length<6){shake("Password must be at least 6 characters.");return;}
    setLoading(true);
    try{
      if(mode==="signup"){
        let cred=null;
        try{
          cred=await createUserWithEmailAndPassword(auth,email.trim(),pw);
        }catch(authErr){
          if(authErr.code==="auth/email-already-in-use")throw new Error("An account with this email already exists. Try logging in.");
          throw authErr;
        }
        const uid=cred.user.uid;
        const referredBy=localStorage.getItem("cq_ref")||null;
        let userData;
        try{
          userData=await createUserDoc(uid,{name:name.trim(),email:email.toLowerCase().trim(),referredBy});
          if(referredBy)localStorage.removeItem("cq_ref");
        }catch(fsErr){
          // Firestore failed — delete the auth account so they can try again
          try{await cred.user.delete();}catch{}
          throw new Error("Something went wrong. Please check your connection and try again.");
        }
        await sendEmailVerification(cred.user);
        setPendingVerify({cred,uid,userData});
        track("signup",{uid});
      }else{
        const cred=await signInWithEmailAndPassword(auth,email.trim(),pw);
        const userData=await getUserDoc(cred.user.uid);
        if(!userData)throw new Error("User data missing.");
        Session.generate();
        track("login",{uid:cred.user.uid});onAuth({uid:cred.user.uid,...userData});
      }
    }catch(e){shake(e.message&&!e.code?e.message:mapErr(e.code));}
    finally{setLoading(false);}
  };

  const handleCheckVerified=async()=>{
    setVerifying(true);setErr("");
    try{
      await pendingVerify.cred.user.reload();
      if(pendingVerify.cred.user.emailVerified){
        Session.generate();
        onAuth({uid:pendingVerify.uid,...pendingVerify.userData});
      }else{
        shake("Not verified yet. Check your inbox and click the link.");
      }
    }catch(e){shake("Something went wrong. Try again.");}
    finally{setVerifying(false);}
  };

  const handleResend=async()=>{
    try{
      await sendEmailVerification(pendingVerify.cred.user);
      setResent(true);setTimeout(()=>setResent(false),4000);
    }catch(e){shake("Too many requests. Wait a moment.");}
  };

  const isDesktop=useIsDesktop(900);

  if(pendingVerify) return (
    <div style={{minHeight:"100dvh",background:"linear-gradient(160deg,#020D08 0%,#061410 30%,#0A1C12 60%,#071009 100%)",color:"#F7F3EC",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
      <div style={{width:"100%",maxWidth:isDesktop?460:"100%",textAlign:"center"}}>
        <div style={{fontSize:52,marginBottom:16}}>📬</div>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:"#F7F3EC",marginBottom:10,lineHeight:1.1}}>Check your inbox.</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(247,243,236,0.4)",lineHeight:1.8,letterSpacing:"0.04em",marginBottom:32}}>
          We sent a verification link to<br/>
          <span style={{color:"#B8973E"}}>{pendingVerify.cred.user.email}</span>
        </div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"rgba(247,243,236,0.25)",textAlign:"center",marginBottom:28,lineHeight:1.9,letterSpacing:"0.06em"}}>
          CLICK THE LINK IN YOUR EMAIL<br/>THEN COME BACK AND TAP BELOW.<br/><br/>CAN'T FIND IT? CHECK YOUR SPAM FOLDER.
        </div>
        {err&&<div style={{background:"rgba(192,57,43,0.12)",border:"1px solid rgba(192,57,43,0.3)",borderRadius:8,padding:"10px 14px",fontFamily:"'DM Mono',monospace",fontSize:10,color:"#C0392B",marginBottom:16,textAlign:"center"}}>{err}</div>}
        {resent&&<div style={{background:"rgba(184,151,62,0.1)",border:"1px solid rgba(184,151,62,0.25)",borderRadius:8,padding:"10px 14px",fontFamily:"'DM Mono',monospace",fontSize:10,color:"#B8973E",marginBottom:16,textAlign:"center"}}>✓ Verification email resent!</div>}
        <BtnPrimary onClick={handleCheckVerified} loading={verifying} T={T}>I've Verified My Email ✓</BtnPrimary>
        <button onClick={handleResend} style={{marginTop:14,background:"none",border:"none",color:"rgba(247,243,236,0.3)",fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer",letterSpacing:"0.1em",width:"100%"}}>RESEND EMAIL</button>
        <button onClick={()=>setPendingVerify(null)} style={{marginTop:8,background:"none",border:"none",color:"rgba(247,243,236,0.18)",fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer",letterSpacing:"0.1em",width:"100%"}}>← BACK TO SIGN UP</button>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100dvh",background:"linear-gradient(160deg,#020D08 0%,#061410 30%,#0A1C12 60%,#071009 100%)",color:"#F7F3EC",display:"flex",flexDirection:isDesktop?"row":"column"}}>

      {/* LEFT — brand panel (desktop only) */}
      {isDesktop&&(
        <div style={{width:"45%",minHeight:"100dvh",display:"flex",flexDirection:"column",justifyContent:"center",padding:"60px 56px",borderRight:"1px solid rgba(184,151,62,0.08)"}}>
          <Logo size={26} onDark={true}/>
          <div style={{marginTop:48,marginBottom:32}}>
            {["Buy every textbook.","Wake up at 4am.","JUPEB is hard."].map((t,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{width:14,height:1,background:"#C0392B",flexShrink:0}}/>
                <span style={{fontSize:15,color:"rgba(247,243,236,0.35)",textDecoration:"line-through",textDecorationColor:"rgba(192,57,43,0.5)"}}>{t}</span>
              </div>
            ))}
          </div>
          <div style={{height:1,background:"linear-gradient(90deg,#B8973E,rgba(184,151,62,0.2),transparent)",marginBottom:32}}/>
          <h1 style={{fontFamily:"'Playfair Display',serif",fontSize:42,fontWeight:900,lineHeight:1.05,color:"#F7F3EC",marginBottom:8}}>You made the<br/>hard choice.</h1>
          <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,fontStyle:"italic",color:"#B8973E",lineHeight:1.1,marginBottom:40}}>Now know if you're ready.</h2>
          <div style={{display:"flex",gap:12}}>
            {[["4,413","QUESTIONS"],["19","SUBJECTS"],["FREE","TO START"]].map(([n,l],i)=>(
              <div key={i} style={{flex:1,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(184,151,62,0.1)",borderRadius:10,padding:"12px 8px",textAlign:"center"}}>
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:"#B8973E"}}>{n}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"rgba(247,243,236,0.3)",letterSpacing:"0.1em",marginTop:3}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RIGHT — form panel */}
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:isDesktop?"60px 72px":"28px 24px 40px"}}>
        {!isDesktop&&<div style={{marginBottom:28,alignSelf:"flex-start"}}><Logo size={22} onDark={true}/></div>}
        <div style={{width:"100%",maxWidth:isDesktop?400:"100%"}}>
          <div style={{marginBottom:28}}>
            <h2 style={{fontFamily:"'Playfair Display',serif",fontSize:isDesktop?28:24,fontWeight:900,color:"#F7F3EC",marginBottom:6}}>{mode==="login"?"Welcome back.":"Create your account."}</h2>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"rgba(247,243,236,0.35)",letterSpacing:"0.06em"}}>{mode==="login"?"Log in to continue your preparation.":"Start measuring your readiness — free."}</div>
          </div>
          <div style={{display:"flex",background:"rgba(255,255,255,0.04)",borderRadius:8,padding:3,marginBottom:20,gap:3}}>
            {["login","signup"].map(m=>(
              <button key={m} className="btn-press" onClick={()=>{setMode(m);setErr("");setTouched({});}} style={{flex:1,padding:"9px 0",border:"none",borderRadius:6,background:mode===m?"#1B3A2A":"transparent",color:mode===m?"#F7F3EC":"rgba(247,243,236,0.4)",fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer",letterSpacing:"0.1em"}}>
                {m==="login"?"LOG IN":"SIGN UP"}
              </button>
            ))}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {mode==="signup"&&(
              <div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.3)",letterSpacing:"0.16em",marginBottom:7}}>YOUR NAME</div>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="What should CrediQ call you?" className={shaking&&!name.trim()?"input-shake":""} style={inp("name")} onFocus={()=>setFocused("name")} onBlur={()=>{setFocused(null);setTouched(t=>({...t,name:true}));}} disabled={loading}/>
                {getInline("name")&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#C0392B",marginTop:5}}>{getInline("name")}</div>}
              </div>
            )}
            <div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.3)",letterSpacing:"0.16em",marginBottom:7}}>EMAIL</div>
              <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="your@email.com" type="email" className={shaking&&(!email.trim()||!email.includes("@"))?"input-shake":""} style={inp("email")} onFocus={()=>setFocused("email")} onBlur={()=>{setFocused(null);setTouched(t=>({...t,email:true}));}} disabled={loading}/>
              {getInline("email")&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#C0392B",marginTop:5}}>{getInline("email")}</div>}
            </div>
            <div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.3)",letterSpacing:"0.16em",marginBottom:7}}>PASSWORD</div>
              <div style={{position:"relative"}}>
                <input value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSubmit()} placeholder="Min. 6 characters" type={showPw?"text":"password"} className={shaking&&pw.length<6?"input-shake":""} style={{...inp("pw"),paddingRight:48}} onFocus={()=>setFocused("pw")} onBlur={()=>{setFocused(null);setTouched(t=>({...t,pw:true}));}} disabled={loading}/>
                <button type="button" onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",padding:4,display:"flex",alignItems:"center",color:"rgba(247,243,236,0.4)"}}>
                  {showPw?<EyeOff size={16}/>:<Eye size={16}/>}
                </button>
              </div>
              {getInline("pw")&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#C0392B",marginTop:5}}>{getInline("pw")}</div>}
            </div>
            {err&&<div style={{background:"rgba(192,57,43,0.12)",border:"1px solid rgba(192,57,43,0.3)",borderRadius:8,padding:"10px 14px",fontFamily:"'DM Mono',monospace",fontSize:10,color:"#C0392B"}}>{err}</div>}
            <BtnPrimary onClick={handleSubmit} loading={loading} T={T}>{mode==="login"?"Enter CrediQ":"Check My Readiness"}</BtnPrimary>
            <div style={{textAlign:"center",fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.2)",letterSpacing:"0.06em"}}>4,413 real JUPEB questions · 19 subjects · 2019–2025</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ONBOARD SCREEN ───────────────────────────────────────────────────────────
function OnboardScreen({user,onDone,dark,setDark,T}){
  const[step,setStep]=useState(0);
  const[course,setCourse]=useState("");
  const[group,setGroup]=useState("");
  const[subjects,setSubjects]=useState([]);
  const[targetUni,setTargetUni]=useState("");
  const[uniSearch,setUniSearch]=useState("");
  const[loading,setLoading]=useState(false);
  const[refCode,setRefCode]=useState("");
  const[refStatus,setRefStatus]=useState(null);
  const[howHeard,setHowHeard]=useState("");
  const[saveError,setSaveError]=useState("");
  const groupForCourse=c=>{for(const[g,cfg]of Object.entries(COURSE_GROUPS))if(cfg.courses.includes(c))return g;return null;};
  const toggle=s=>{if(subjects.includes(s))setSubjects(subjects.filter(x=>x!==s));else if(subjects.length<3)setSubjects([...subjects,s]);};
  const avail=group?COURSE_GROUPS[group]?.subjects||[]:[];
  const uniSearchResults=useMemo(()=>searchUniversities(uniSearch,course||null),[uniSearch,course]);
  const jupebUnis=uniSearchResults.filter(u=>u.acceptsJUPEB);
  const nonJupebHit=uniSearchResults.filter(u=>!u.acceptsJUPEB);
  const hasUniStep=true;
  const totalSteps=3;
  const canNext=step===0?!!course:step===1?!!targetUni:(subjects.length===3&&!!howHeard);

  const next=async()=>{
    if(step===0){const g=groupForCourse(course);setGroup(g||"Sciences");setStep(1);}
    else if(step===1){setStep(2);}
    else{await doSave();}
  };

  const doSave=async()=>{
    setLoading(true);
    try{
      let resolvedRef=null;
      const code=refCode.trim().toUpperCase();
      if(code){
        try{
          const refSnap=await getDoc(doc(db,"referrals",code));
          if(refSnap.exists()){
            resolvedRef=code;setRefStatus("valid");
            try{await updateDoc(doc(db,"referrals",code),{signups:increment(1)});}catch(e){}
          }else{
            const uq=query(collection(db,"users"),where("referralCode","==",code));
            const uSnap=await getDocs(uq);
            if(!uSnap.empty){
              resolvedRef=code;setRefStatus("valid");
              const ambassadorUid=uSnap.docs[0].id;
              try{
                await updateDoc(doc(db,"users",ambassadorUid),{referralCount:increment(1)});
                const signupEntry={uid:user.uid,name:user.name||"",date:new Date().toISOString(),isPaid:false};
                await updateDoc(doc(db,"referrals",code),{signups:increment(1),signupsList:arrayUnion(signupEntry)});
              }catch(e){}
            }else{setRefStatus("invalid");}
          }
        }catch(e){console.warn("Referral check failed:",e);}
      }
      const requiredPoints=targetUni?getRequiredPoints(targetUni,course):parseInt(localStorage.getItem("cq_target_pts")||"13");
      const up={...user,course,group,subjects,onboarded:true,targetPoints:requiredPoints,targetUniversity:targetUni,requiredPoints,referralSource:howHeard,referredBy:resolvedRef||user.referredBy||null};
      await updateDoc(doc(db,"users",user.uid),{course,group,subjects,onboarded:true,targetPoints:requiredPoints,targetUniversity:targetUni,requiredPoints,referralSource:howHeard,...(resolvedRef?{referredBy:resolvedRef}:{})});
      track("onboard_complete",{uid:user.uid,course,targetUniversity:targetUni,subjects});
      onDone(up);
    }catch(e){
      console.error("Onboard save failed:",e);
      setSaveError("Couldn't save — check your connection and try again.");
    }finally{setLoading(false);}
  };

  const stepNum=step===0?1:step===1?2:3;
  const progress=stepNum/totalSteps;

  return(
    <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,paddingBottom:40}}>
      <div style={{background:"#0f2218",padding:"22px 22px 18px",borderBottom:"1px solid rgba(184,151,62,0.15)"}}>
        <Logo size={22} onDark={true}/>
        <div style={{marginTop:14}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.5)",letterSpacing:"0.15em"}}>STEP {stepNum} OF {totalSteps}</div>
            {step>0&&<button className="btn-press" onClick={()=>setStep(s=>Math.max(0,s-1))} style={{background:"none",border:"none",color:"rgba(247,243,236,0.35)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:9}}>← Back</button>}
          </div>
          <div style={{height:3,background:"rgba(255,255,255,0.07)",borderRadius:2}}>
            <div style={{height:"100%",width:`${progress*100}%`,background:"#B8973E",borderRadius:2,transition:"width .4s cubic-bezier(.16,1,.3,1)"}}/>
          </div>
        </div>
      </div>

      <div style={{padding:"24px 20px"}}>

        {/* STEP 0 — Where are we going? */}
        {step===0&&(
          <>
            <div className="fi1" style={{marginBottom:20}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:24,fontWeight:900,color:T.text,lineHeight:1.2}}>Where are<br/>we going?</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginTop:8,lineHeight:1.7}}>Pick your target course. Your entire JUPEB plan will be built around this.</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {ALL_COURSES.map(c=>(
                <div key={c} className="btn-press" onClick={()=>setCourse(c)} style={{padding:"13px 16px",background:course===c?"rgba(184,151,62,0.12)":T.surface,border:`1px solid ${course===c?T.gold:T.border}`,borderRadius:9,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:14,color:T.text,fontWeight:course===c?600:400}}>{c}</span>
                  {course===c&&<CheckCircle size={14} color={T.gold}/>}
                </div>
              ))}
            </div>
          </>
        )}

        {/* STEP 1 — Where are we fighting for? */}
        {step===1&&(
          <>
            <div className="fi1" style={{marginBottom:18}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:24,fontWeight:900,color:T.text,lineHeight:1.2}}>
                Where are we<br/>fighting for? 🎯
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginTop:8,lineHeight:1.7}}>
                Your university target determines your required points, subject priorities, and your entire study plan.
              </div>
            </div>

            {/* Search */}
            <div style={{position:"relative",marginBottom:16}}>
              <input value={uniSearch} onChange={e=>setUniSearch(e.target.value)}
                placeholder="Search by name, city, or abbreviation…"
                style={{width:"100%",background:"rgba(255,255,255,0.04)",border:`1px solid ${T.border}`,
                  borderRadius:10,padding:"13px 16px 13px 40px",fontSize:13,color:T.text,
                  outline:"none",fontFamily:"'DM Mono',monospace",boxSizing:"border-box"}}/>
              <div style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",
                color:T.muted,pointerEvents:"none"}}>🔍</div>
              {uniSearch&&(
                <button onClick={()=>setUniSearch("")}
                  style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",
                    background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:18,lineHeight:1}}>×</button>
              )}
            </div>

            {/* Popular picks — only when not searching */}
            {!uniSearch&&(
              <div style={{marginBottom:20}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.gold}55`,letterSpacing:"0.18em",marginBottom:10}}>
                  🔥 POPULAR AMONG JUPEB STUDENTS
                </div>
                <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,scrollbarWidth:"none"}}>
                  {UNIVERSITIES_DATA.filter(u=>u.acceptsJUPEB&&u.popularRank<=6)
                    .sort((a,b)=>a.popularRank-b.popularRank)
                    .map(u=>{
                      const sel=targetUni===u.shortName;
                      const hasCourse=!!u.courses[course];
                      return(
                        <button key={u.shortName} className="btn-press"
                          onClick={()=>setTargetUni(sel?"":u.shortName)}
                          style={{flexShrink:0,padding:"8px 16px",
                            background:sel?"rgba(184,151,62,0.15)":"rgba(255,255,255,0.04)",
                            border:`1.5px solid ${sel?T.gold:hasCourse?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.05)"}`,
                            borderRadius:100,cursor:"pointer",
                            color:sel?T.gold:hasCourse?T.text:`${T.muted}88`,
                            fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:sel?700:400}}>
                          {u.shortName}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Non-JUPEB warning */}
            {nonJupebHit.length>0&&uniSearch.length>=2&&(
              <div style={{marginBottom:14,padding:"14px 16px",
                background:"rgba(245,158,11,0.07)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:12}}>
                {nonJupebHit.map(u=>(
                  <div key={u.shortName}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#f59e0b",letterSpacing:"0.14em",marginBottom:5}}>
                      ⚠️ JUPEB STATUS — {u.shortName}
                    </div>
                    <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,fontWeight:700,color:T.text,marginBottom:6}}>{u.name}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,lineHeight:1.7}}>{u.jupebWarning}</div>
                  </div>
                ))}
              </div>
            )}

            {/* University list — grouped by tier */}
            {[1,2,3].map(tier=>{
              const tierUnis=jupebUnis.filter(u=>u.tier===tier);
              if(!tierUnis.length)return null;
              return(
                <div key={tier} style={{marginBottom:18}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.gold}55`,letterSpacing:"0.18em",marginBottom:8,paddingLeft:2}}>
                    {getTierLabel(tier)}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {tierUnis.map(u=>{
                      const cd=u.courses[course];
                      const sel=targetUni===u.shortName;
                      const hasCourse=!!cd;
                      return(
                        <div key={u.shortName} className="btn-press"
                          onClick={()=>setTargetUni(sel?"":u.shortName)}
                          style={{padding:"14px 16px",
                            background:sel?"rgba(184,151,62,0.1)":T.surface,
                            border:`1px solid ${sel?T.gold:T.border}`,
                            borderRadius:12,cursor:"pointer",opacity:!hasCourse&&course?0.45:1}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                                <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:700,color:sel?T.gold:T.text}}>{u.shortName}</div>
                                <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted}}>{u.type}</div>
                              </div>
                              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}88`,marginBottom:2}}>{u.name}</div>
                              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}60`}}>📍 {u.location}</div>
                            </div>
                            {hasCourse?(
                              <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                                <div style={{fontFamily:"'Playfair Display',serif",fontSize:24,fontWeight:900,color:sel?T.gold:T.muted,lineHeight:1}}>{cd.minPoints}</div>
                                <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.muted,letterSpacing:"0.08em",marginTop:2}}>PTS NEEDED</div>
                              </div>
                            ):course&&(
                              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}50`,flexShrink:0,marginLeft:12}}>N/A</div>
                            )}
                          </div>

                          {sel&&cd&&(
                            <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid rgba(184,151,62,0.15)`}}>
                              {/* Safe vs Stretch */}
                              {(()=>{
                                const pts=cd.minPoints;
                                const isStretch=pts>=15,isGood=pts>=12&&pts<15;
                                return(
                                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,padding:"8px 12px",borderRadius:8,
                                    background:isStretch?"rgba(239,68,68,0.08)":isGood?"rgba(249,115,22,0.07)":"rgba(74,222,128,0.07)",
                                    border:`1px solid ${isStretch?"rgba(239,68,68,0.2)":isGood?"rgba(249,115,22,0.2)":"rgba(74,222,128,0.2)"}`}}>
                                    <div style={{fontSize:16,flexShrink:0}}>{isStretch?"🔥":isGood?"⚡":"✅"}</div>
                                    <div>
                                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,
                                        color:isStretch?"#ef4444":isGood?"#f97316":"#4ade80",letterSpacing:"0.1em"}}>
                                        {isStretch?"STRETCH TARGET":isGood?"STRONG TARGET":"SAFE TARGET"}
                                      </div>
                                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,marginTop:2}}>
                                        {isStretch?`${pts} pts — highly competitive path`:isGood?`${pts} pts — achievable with consistency`:`${pts} pts — within reach with good prep`}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,marginBottom:6}}>PREFERRED SUBJECTS</div>
                              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                                {cd.combination.map(s=>(
                                  <div key={s} style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.gold,
                                    background:`${T.gold}12`,border:`1px solid ${T.gold}25`,borderRadius:6,padding:"3px 8px"}}>{s}</div>
                                ))}
                              </div>
                              {cd.label&&(
                                <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,fontWeight:700,marginTop:8,letterSpacing:"0.08em",
                                  color:cd.label==="Highly Competitive"?"#ef4444":cd.label==="Competitive"?"#f97316":"#4ade80"}}>
                                  {cd.label}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {jupebUnis.length===0&&uniSearch.length>=2&&nonJupebHit.length===0&&(
              <div style={{textAlign:"center",padding:"30px 20px",fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,lineHeight:1.8}}>
                No results for "{uniSearch}".<br/>Try the full name, city, or abbreviation.
              </div>
            )}
          </>
        )}

        {/* STEP 2 — Subjects */}
        {step===2&&(
          <>
            <div className="fi1" style={{marginBottom:20}}>
              {targetUni&&(
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,padding:"10px 14px",background:"rgba(184,151,62,0.07)",border:"1px solid rgba(184,151,62,0.2)",borderRadius:9}}>
                  <div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:`${T.gold}80`,letterSpacing:"0.14em",marginBottom:2}}>YOUR TARGET</div>
                    <div style={{fontFamily:"'Playfair Display',serif",fontSize:13,fontWeight:700,color:T.gold}}>{targetUni} · {course}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted}}>Need {getRequiredPoints(targetUni,course)} pts to qualify</div>
                  </div>
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:26,fontWeight:900,color:T.gold}}>{getRequiredPoints(targetUni,course)}</div>
                </div>
              )}
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:900,color:T.text}}>Your 3 JUPEB subjects</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginTop:6}}>{group} · Choose exactly 3 — these are your battlefield</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:subjects.length===3?T.success:T.muted,marginTop:4}}>{subjects.length}/3 selected{subjects.length===3?" — Perfect ✓":""}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {avail.map(s=>{
                const meta=SUBJECT_META[s]||{icon:"BKS",color:"#B8973E"};
                const sel=subjects.includes(s),maxed=!sel&&subjects.length>=3;
                const preferred=targetUni?getPreferredSubjects(targetUni,course).includes(s):false;
                return(
                  <div key={s} onClick={()=>!maxed&&toggle(s)} style={{padding:"13px 16px",background:sel?`${meta.color}15`:T.surface,border:`1px solid ${sel?meta.color:preferred?`${T.gold}44`:T.border}`,borderRadius:9,cursor:maxed?"not-allowed":"pointer",opacity:maxed?0.4:1,display:"flex",alignItems:"center",gap:12}}>
                    <SubjectBadge code={meta.icon} color={meta.color} size={20}/>
                    <span style={{fontSize:14,color:T.text,fontWeight:sel?600:400,flex:1}}>{s}</span>
                    {preferred&&!sel&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.gold,letterSpacing:"0.1em"}}>RECOMMENDED</span>}
                    {sel&&<span style={{color:meta.color}}>✓</span>}
                  </div>
                );
              })}
            </div>
            <div style={{marginTop:14,padding:"14px 16px",background:T.surface,borderRadius:10,border:`1px solid ${T.border}`}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:8}}>GOT A REFERRAL CODE? (OPTIONAL)</div>
              <input value={refCode} onChange={e=>{setRefCode(e.target.value.toUpperCase());setRefStatus(null);}} placeholder="e.g. ADMIN001" maxLength={20}
                style={{width:"100%",background:"rgba(255,255,255,0.04)",border:`1px solid ${refStatus==="valid"?"rgba(74,222,128,0.5)":refStatus==="invalid"?"rgba(192,57,43,0.5)":T.border}`,borderRadius:8,padding:"11px 14px",fontSize:15,color:T.text,outline:"none",letterSpacing:"0.08em",fontFamily:"'DM Mono',monospace"}}/>
              {refStatus==="valid"&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.success,marginTop:6}}>✓ Valid referral code applied</div>}
              {refStatus==="invalid"&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.danger,marginTop:6}}>✗ Code not found — continuing without it</div>}
            </div>
            <div style={{marginTop:14,padding:"14px 16px",background:T.surface,borderRadius:10,border:`1px solid ${howHeard?T.gold:T.border}`}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:10}}>HOW DID YOU HEAR ABOUT CREDIQ? <span style={{color:T.danger}}>*</span></div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {HEARD_OPTIONS.map(opt=>{
                  const sel=howHeard===opt;
                  return(
                    <button key={opt} onClick={()=>setHowHeard(opt)}
                      style={{padding:"8px 14px",borderRadius:20,border:`1px solid ${sel?T.gold:T.border}`,background:sel?`${T.gold}18`:"transparent",color:sel?T.gold:T.muted,fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer",letterSpacing:"0.06em",fontWeight:sel?700:400,transition:"all .2s"}}>
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div style={{marginTop:24}}>
          <BtnPrimary onClick={next} disabled={!canNext} loading={loading} T={T}>
            {step===0?"Continue →":step===1?"Lock In My Target →":"Begin My Mission →"}
          </BtnPrimary>
          {saveError&&(
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#ef4444",textAlign:"center",marginTop:10,lineHeight:1.6}}>
              {saveError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function DashboardScreen({user,history,historyLoaded,QB,onNav,onLogout,dark,setDark,T,showToast,streak,onUpgrade}) {
  const readiness=useMemo(()=>calcReadiness(history),[history]);
  const weakTopics=useMemo(()=>calcWeakTopics(history),[history]);
  const topicStatus=useMemo(()=>calcTopicStatus(history),[history]);
  const subjectStats=useMemo(()=>calcSubjectStats(history),[history]);
  const userSubjects=user.subjects||[];
  const future=getFuture(user.course);

  const daysLeft=daysUntil("2026-08-03");
  const nextExam=useMemo(()=>getNextExam(userSubjects),[userSubjects]);
  const studyMins=useMemo(()=>calcStudyTime(history),[history]);
  const readinessTrend=useMemo(()=>calcReadinessTrend(history),[history]);
  const reviewQueue=useMemo(()=>calcReviewQueue(history),[history]);
  const latestCBT=useMemo(()=>{
    const sims=history.filter(h=>h.mode==="full").sort((a,b)=>new Date(b.date)-new Date(a.date));
    return sims[0]||null;
  },[history]);
  const topicImprovement=useMemo(()=>calcTopicImprovement(history),[history]);
  const MARK_EST=["5–8","3–5","2–3","1–2"];
  const MARK_LO=[5,3,2,1];
  const MARK_HI=[8,5,3,2];
  const topN=Math.min(weakTopics.length,3);
  const totalLo=MARK_LO.slice(0,topN).reduce((a,b)=>a+b,0);
  const totalHi=MARK_HI.slice(0,topN).reduce((a,b)=>a+b,0);

  // ── JUPEB POINTS PROJECTION — partial data shown, never null ────────────────
  const pointsData=useMemo(()=>{
    if(!userSubjects.length)return null;
    const subAccuracies=userSubjects.map(sub=>{
      const h=history.filter(x=>x.subject===sub);
      if(!h.length)return{subject:sub,accuracy:null,hasData:false};
      const acc=Math.round(h.reduce((s,x)=>s+x.pct,0)/h.length);
      return{subject:sub,accuracy:acc,hasData:true};
    });
    const withData=subAccuracies.filter(x=>x.hasData);
    if(!withData.length)return null;
    // Project points — subjects with no data assumed to be current worst grade
    const worstAcc=withData.length?Math.min(...withData.map(x=>x.accuracy)):50;
    const filled=subAccuracies.map(x=>x.hasData?x:{...x,accuracy:worstAcc,estimated:true});
    return{
      ...projectedPoints(filled.map(x=>({subject:x.subject,accuracy:x.accuracy}))),
      subjects:filled,
      hasPartialData:subAccuracies.some(x=>!x.hasData),
    };
  },[history,userSubjects]);

  const targetPts=useMemo(()=>{
    const uni=user?.targetUniversity||"";
    const course=user?.course||"";
    if(uni&&course){const r=getRequiredPoints(uni,course);if(r)return r;}
    return user?.requiredPoints||user?.targetPoints||13;
  },[user]);
  const targetUni=user?.targetUniversity||"";
  const targetCourse=user?.course||"";
  // Derive uni shortName label + course shorthand for hero title
  const uniData=UNIVERSITIES_DATA.find(u=>u.shortName===targetUni)||null;
  const heroTitle=uniData&&targetCourse?`${uniData.shortName} ${targetCourse.split("/")[0].trim().toUpperCase()} JOURNEY`:"YOUR JUPEB JOURNEY";
  const uniCutoff=targetPts;
  const weeklyMission=useMemo(()=>calcWeeklyMission(history,weakTopics,readiness,userSubjects),[history,weakTopics,readiness,userSubjects]);

  // ── TODAY'S MOVE — rule-based JUPEB coach picks single highest-impact topic ──
  const todayMission=useMemo(()=>{
    let best=null;let bestScore=-Infinity;
    const preferredSubs=getPreferredSubjects(user?.targetUniversity||"",user?.course||"");
    for(const sub of userSubjects){
      const subH=history.filter(h=>h.subject===sub);
      if(!subH.length)continue;
      const subAvg=Math.round(subH.reduce((s,x)=>s+x.pct,0)/subH.length);
      const gradeGap=Math.max(0,60-subAvg);
      // University boost: preferred subjects get 1.35x weight in mission scoring
      const isPreferred=preferredSubs.length>0&&preferredSubs.some(p=>sub.toLowerCase().includes(p.toLowerCase().split(" ")[0])||p.toLowerCase().includes(sub.toLowerCase().split(" ")[0]));
      const uniBoost=isPreferred?1.35:1;
      const topicData={};
      subH.forEach(h=>{
        (h.questionResults||[]).forEach(r=>{
          if(!r.topic)return;
          if(!topicData[r.topic])topicData[r.topic]={correct:0,total:0};
          topicData[r.topic].total++;
          if(r.correct)topicData[r.topic].correct++;
        });
      });
      for(const[topic,data]of Object.entries(topicData)){
        if(data.total<3)continue;
        const acc=Math.round((data.correct/data.total)*100);
        if(acc>=60)continue;
        const score=(60-acc)*Math.log(data.total+1)*(1+gradeGap/100)*uniBoost;
        if(score>bestScore){
          bestScore=score;
          const subGradeData=jupebGrade(subAvg);
          const nextTarget=subAvg>=60?"A":subAvg>=50?"B":"B";
          best={subject:sub,topic,accuracy:acc,total:data.total,subGrade:subGradeData,nextGradeTarget:nextTarget,isPreferred};
        }
      }
    }
    if(!best&&weakTopics.length>0){
      const topItem=weakTopics[0];
      const top=typeof topItem==="string"?topItem:topItem.t;
      const topSubject=typeof topItem==="object"&&topItem.subject?topItem.subject:"";
      // Try to find subject from topic-subject map
      if(topSubject)return{subject:topSubject,topic:top,accuracy:null,total:0,subGrade:null,nextGradeTarget:"B"};
      for(const sub of userSubjects){
        const code=getQuestionCourse(sub,top);
        if(code)return{subject:sub,topic:top,accuracy:null,total:0,subGrade:null,nextGradeTarget:"B"};
      }
      return{subject:userSubjects[0]||"",topic:top,accuracy:null,total:0,subGrade:null,nextGradeTarget:"B"};
    }
    return best;
  },[history,userSubjects,weakTopics]);

  // ── SUBJECT ROWS — per-subject grade data for home screen rows ────────────
  const subjectRows=useMemo(()=>userSubjects.map(sub=>{
    const h=history.filter(x=>x.subject===sub);
    const avg=h.length?Math.round(h.reduce((s,x)=>s+x.pct,0)/h.length):null;
    const gradeData=avg!==null?jupebGrade(avg):null;
    return{subject:sub,avg,gradeData,sessions:h.length};
  }),[history,userSubjects]);

  // ── SCORE BLOCKERS per subject — current/target/cost for home screen ──────
  const blockersBySubject=useMemo(()=>{
    return userSubjects.map(sub=>{
      const subH=history.filter(h=>h.subject===sub);
      if(!subH.length)return{subject:sub,blockers:[]};
      const topicData={};
      subH.forEach(h=>{
        (h.questionResults||[]).forEach(r=>{
          if(!r.topic)return;
          if(!topicData[r.topic])topicData[r.topic]={correct:0,total:0};
          topicData[r.topic].total++;
          if(r.correct)topicData[r.topic].correct++;
        });
      });
      const blockers=Object.entries(topicData)
        .map(([topic,data])=>{
          const acc=Math.round((data.correct/data.total)*100);
          const costPct=Math.max(0,60-acc);
          return{topic,accuracy:acc,total:data.total,costPct};
        })
        .filter(b=>b.accuracy<60&&b.total>=3)
        .sort((a,b)=>b.costPct-a.costPct)
        .slice(0,2);
      return{subject:sub,blockers};
    }).filter(x=>x.blockers.length>0);
  },[history,userSubjects]);

  // ── FASTEST ROUTE — rank subjects with data by recovery opportunity ───────
  const fastestRoute=useMemo(()=>{
    return subjectRows.filter(r=>r.sessions>0).map(r=>{
      const sb=blockersBySubject.find(b=>b.subject===r.subject);
      const blockerCost=sb?sb.blockers.reduce((s,bl)=>s+bl.costPct,0):0;
      const roomToGrow=Math.max(0,70-(r.avg||0))*0.3;
      return{subject:r.subject,score:blockerCost+roomToGrow};
    }).sort((a,b)=>b.score-a.score).filter(r=>r.score>0);
  },[subjectRows,blockersBySubject]);

  // ── SUBJECT STORY — narrative status label instead of a bare grade ────────
  const subjectStory=(row)=>{
    if(row.sessions===0)return"1,200+ questions ready";
    const sb=blockersBySubject.find(b=>b.subject===row.subject);
    const hasBlockers=sb&&sb.blockers.length>0;
    const g=row.gradeData?.grade;
    if(fastestRoute[0]&&fastestRoute[0].subject===row.subject&&hasBlockers)return"Fastest gain";
    if(g==="A")return"Locked in";
    if((row.avg||0)<40)return"Needs focus";
    if(hasBlockers)return"Needs work";
    return"Building momentum";
  };

  // ── FASTEST IMPROVING topic ──────────────────────────────────────────────
  const fastestImprovement=useMemo(()=>{
    if(!topicImprovement||!topicImprovement.length)return null;
    const best=topicImprovement[0]; // already sorted by delta desc
    if(!best||best.delta<=0)return null;
    // Find which subject this topic belongs to
    for(const sub of userSubjects){
      const code=getQuestionCourse(sub,best.topic);
      if(code)return{topic:best.topic,subject:sub,delta:best.delta};
    }
    return{topic:best.topic,subject:"",delta:best.delta};
  },[topicImprovement,userSubjects]);

  // scoreColor and readiness animation handled in return below

  // Per-subject intelligence for alive subject cards
  const subWeakData=useMemo(()=>{
    const strongest=userSubjects.reduce((best,sub)=>{
      const st=subjectStats[sub];if(!st)return best;
      const avg=Math.round(st.totalPct/st.sessions);
      const bst=subjectStats[best];const bavg=bst?Math.round(bst.totalPct/bst.sessions):0;
      return avg>bavg?sub:best;
    },userSubjects[0]||"");
    return userSubjects.reduce((acc,sub)=>{
      // QB[sub] is {year:[...questions]} — use getAllQuestionsForSubject to flatten safely
      const subQTopics=new Set(getAllQuestionsForSubject(QB,sub).map(q=>q.topic).filter(Boolean));
      const subWeak=weakTopics.filter(w=>subQTopics.has(w));
      const lo=subWeak.reduce((s,_,i)=>s+(MARK_LO[Math.min(i,3)]||1),0);
      const hi=subWeak.reduce((s,_,i)=>s+(MARK_HI[Math.min(i,3)]||2),0);
      acc[sub]={weakCount:subWeak.length,lo,hi,isStrongest:sub===strongest&&(subjectStats[sub]?.sessions||0)>0};
      return acc;
    },{});
  },[userSubjects,weakTopics,subjectStats,QB]);

  const [expandedSubject,setExpandedSubject]=useState(null);
  const [displayPoints,setDisplayPoints]=useState(0);
  const [competitionData,setCompetitionData]=useState(null);
  const hasData=history.length>0;
  const firstName=user.name?.split(" ")[0]||"";
  // First session activation — show once per user
  const showActivation=useMemo(()=>{
    if(history.filter(isRealSession).length!==1)return false;
    const key="cq_activated_"+user.uid;
    if(localStorage.getItem(key))return false;
    localStorage.setItem(key,"1");
    return true;
  },[history,user.uid]);
  const gap=pointsData?Math.max(0,(targetPts-pointsData.total)).toFixed(1):null;
  const scoreColor=!pointsData?"rgba(184,151,62,0.4)":pointsData.total>=targetPts?"#4ade80":pointsData.total>=(targetPts-2)?T.gold:"#f97316";
  const totalRealSessions=history.filter(isRealSession).length;
  const statusInfo=!pointsData?null:
    Number(gap)<=0?{label:"ON TRACK",color:"#4ade80",msg:"Sharp sharp 🔥 Keep this pace."}:
    Number(gap)<=1.5?{label:"VERY CLOSE",color:"#4ade80",msg:"Still within reach. One strong week changes everything."}:
    Number(gap)<=3?{label:"IN RANGE",color:T.gold,msg:"You're closer than you think. Keep pushing."}:
    totalRealSessions<4?{label:"BUILDING PLAN",color:`${T.muted}cc`,msg:"Your plan is taking shape. Keep going."}:
    {label:"AT RISK",color:"#f97316",msg:"Every session moves you forward. Start today."};

  // ── Competition ranking — query peers with same target ────────────────────
  useEffect(()=>{
    if(!user?.targetUniversity||!user?.course||!pointsData||!hasData)return;
    let cancelled=false;
    const fetchPeers=async()=>{
      try{
        const q=query(collection(db,"users"),where("targetUniversity","==",user.targetUniversity),where("course","==",user.course),limit(60));
        const snap=await getDocs(q);
        const peers=snap.docs.map(d=>d.data()).filter(p=>p.uid!==user.uid&&typeof p.currentPoints==="number");
        if(cancelled)return;
        if(peers.length<5){setCompetitionData({total:snap.docs.length,percentile:null});return;}
        const myPts=pointsData.total;
        const ahead=peers.filter(p=>p.currentPoints<myPts).length;
        const percentile=Math.round((ahead/peers.length)*100);
        setCompetitionData({total:peers.length+1,percentile,shortName:user.targetUniversity,course:user.course.split("/")[0].trim()});
      }catch(e){console.warn("Competition query (may need Firestore index):",e);}
    };
    fetchPeers();
    return()=>{cancelled=true;};
  },[user?.targetUniversity,user?.course,hasData,pointsData?.total]);
  useEffect(()=>{
    if(!pointsData)return;
    const target=pointsData.total;
    let frame=0;const totalFrames=80;
    const t=setInterval(()=>{
      frame++;
      const p=frame/totalFrames;
      const eased=1-Math.pow(1-p,3);
      setDisplayPoints(parseFloat((eased*target).toFixed(1)));
      if(frame>=totalFrames){setDisplayPoints(target);clearInterval(t);}
    },16);
    return()=>clearInterval(t);
  },[pointsData?.total]);

  // ── Phase 3: typewriter coach line ────────────────────────────────────────
  // missionList: top 2 recovery opportunities across subjects with point potential
  const missionList=useMemo(()=>{
    const allM=[];
    const preferredSubs=getPreferredSubjects(user?.targetUniversity||"",user?.course||"");
    for(const sub of userSubjects){
      const subH=history.filter(h=>h.subject===sub);
      if(!subH.length)continue;
      const subAvg=Math.round(subH.reduce((s,x)=>s+x.pct,0)/subH.length);
      const gradeGap=Math.max(0,60-subAvg);
      const isPreferred=preferredSubs.length>0&&preferredSubs.some(p=>sub.toLowerCase().includes(p.toLowerCase().split(" ")[0])||p.toLowerCase().includes(sub.toLowerCase().split(" ")[0]));
      const uniBoost=isPreferred?1.35:1;
      const topicData={};
      subH.forEach(h=>(h.questionResults||[]).forEach(r=>{
        if(!r.topic)return;
        if(!topicData[r.topic])topicData[r.topic]={correct:0,total:0};
        topicData[r.topic].total++;
        if(r.correct)topicData[r.topic].correct++;
      }));
      for(const[topic,data]of Object.entries(topicData)){
        if(data.total<3)continue;
        const acc=Math.round((data.correct/data.total)*100);
        if(acc>=60)continue;
        const score=(60-acc)*Math.log(data.total+1)*(1+gradeGap/100)*uniBoost;
        const pointPotential=Math.max(0.1,((60-acc)*0.012)).toFixed(1);
        allM.push({subject:sub,topic,accuracy:acc,total:data.total,subGrade:jupebGrade(subAvg),nextGradeTarget:subAvg>=60?"A":"B",isPreferred,score,pointPotential});
      }
    }
    return allM.sort((a,b)=>b.score-a.score).slice(0,2);
  },[history,userSubjects,user?.targetUniversity,user?.course]);

  const [typedText,setTypedText]=useState("");
  const coachMsg=missionList.length>0
    ?(uniData&&Number(gap)>0
      ?`${firstName?firstName+", ":""}you need +${gap} pts to reach ${uniData.shortName} ${targetCourse.split("/")[0].trim()}. Here's your fastest path.`
      :`${firstName?firstName+", ":""}small work today. Here are your two biggest gaps right now.`)
    :"";
  useEffect(()=>{
    if(!coachMsg){setTypedText("");return;}
    setTypedText("");
    let i=0;
    const t=setInterval(()=>{
      i++;
      setTypedText(coachMsg.slice(0,i));
      if(i>=coachMsg.length)clearInterval(t);
    },40);
    return()=>clearInterval(t);
  },[coachMsg]);

  const EASE=[0.16,1,0.3,1];
  const subjStagger=0.35+subjectRows.length*0.08;
  // Heuristic, directional estimate only — not a precise grade calculator
  const potentialRecovery=(todayMission&&todayMission.accuracy!==null)?Math.max(0.1,(60-todayMission.accuracy)*0.012).toFixed(1):null;
  const ringSize=176, ringStroke=10, ringR=(ringSize-ringStroke)/2, ringC=2*Math.PI*ringR;
  const ringFrac=pointsData?Math.min(1,pointsData.total/targetPts):Math.min(1,(readiness||0)/100);
  const isDesktop=useIsDesktop(900);

  return (
    <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,paddingBottom:90}}>

      {/* ── HEADER ── */}
      <div style={{padding:"14px 20px 10px",borderBottom:`1px solid ${T.navBorder}`,background:T.navBg,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{duration:0.3}}>
            <Logo size={20} onDark={dark}/>
          </motion.div>
          <motion.div initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} transition={{duration:0.3,delay:0.2,ease:EASE}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.gold}55`,letterSpacing:"0.2em",marginTop:3,marginBottom:1}}>
              {streak>=2?`DAY ${streak} 🔥`:"JUPEB 2026"}
            </div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:`${T.muted}99`}}>{getGreet()} {firstName}</div>
          </motion.div>
        </div>
        <motion.div initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} transition={{duration:0.3,delay:0.2,ease:EASE}} style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:900,color:daysLeft>60?"#4ade80":daysLeft>30?T.gold:"#f97316",lineHeight:1}}>{daysLeft}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:daysLeft>60?"rgba(74,222,128,0.5)":daysLeft>30?`${T.gold}80`:"rgba(249,115,22,0.5)",letterSpacing:"0.12em"}}>DAYS LEFT</div>
          </div>
          {user.isPremium&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#4ade80",fontWeight:700}}>✦</div>}
          <InstallButton T={T}/>
          <ThemeBtn dark={dark} setDark={setDark} T={T}/>
        </motion.div>
      </div>

      <div style={{padding:isDesktop?"24px 32px 0":"18px 18px 0",maxWidth:isDesktop?1100:640,margin:"0 auto",width:"100%"}}>

        {/* ── FIRST SESSION ACTIVATION ── */}
        {showActivation&&(
          <motion.div initial={{opacity:0,y:-16,scale:0.97}} animate={{opacity:1,y:0,scale:1}} transition={{type:"spring",stiffness:300,damping:22,delay:0.4}}
            style={{background:"rgba(74,222,128,0.07)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:12,padding:"16px 18px",marginBottom:16,textAlign:"center"}}>
            <div style={{fontSize:26,marginBottom:6}}>🔥</div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:700,color:"#4ade80",marginBottom:4}}>Your JUPEB profile just came alive.</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(74,222,128,0.6)",lineHeight:1.7}}>That's your first data point. Keep practicing and CrediQ builds your complete score map.</div>
          </motion.div>
        )}

        {/* ── MILESTONE: PARENT CONFIDENCE ── */}
        {streak>=14&&(
          <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.4,delay:0.15,ease:EASE}}
            style={{background:"rgba(184,151,62,0.07)",border:"1px solid rgba(184,151,62,0.25)",borderRadius:12,padding:"14px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:14}}>
            <div style={{fontSize:28,flexShrink:0}}>🏆</div>
            <div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.gold}70`,letterSpacing:"0.16em",marginBottom:4}}>DAY {streak} CONSISTENCY</div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:13,fontWeight:600,color:T.text,lineHeight:1.4}}>"You're building the kind of consistency that gets admissions."</div>
            </div>
          </motion.div>
        )}

        {/* ── DESKTOP 2-COLUMN GRID ── */}
        <div className={isDesktop?"cq-dash-grid":""}>
        <div className={isDesktop?"cq-dash-col":""}>{/* ← LEFT COLUMN: journey + plan */}

        {/* ── COMMUNITY COUNTER ── */}
        {(()=>{
          const dayOfYear=Math.floor((Date.now()-new Date(new Date().getFullYear(),0,0))/86400000);
          const count=1800+((dayOfYear*127+43)%600);
          return(
            <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{duration:0.5,delay:0.2}}
              style={{textAlign:"center",marginBottom:14}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}55`,letterSpacing:"0.12em"}}>
                {count.toLocaleString()} JUPEB students practiced today
              </div>
            </motion.div>
          );
        })()}

        {/* ── DREAM TARGET STRIP ── */}
        {uniData&&(
          <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.4,delay:0.08,ease:EASE}}
            style={{padding:"14px 16px",marginBottom:16,background:T.surface,border:`1px solid ${T.border}`,borderRadius:14}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.gold}66`,letterSpacing:"0.18em",marginBottom:8}}>YOUR TARGET</div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"45%"}}>
                {uniData.shortName} · {targetCourse.split("/")[0].trim()}
              </div>
              <div style={{display:"flex",gap:16,flexShrink:0}}>
                <div style={{textAlign:"center"}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.muted,letterSpacing:"0.1em",marginBottom:2}}>REQUIRED</div>
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:T.gold}}>{targetPts} pts</div>
                </div>
                {pointsData&&(
                  <>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.muted,letterSpacing:"0.1em",marginBottom:2}}>CURRENT</div>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:scoreColor}}>{pointsData.total.toFixed(1)} pts</div>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.muted,letterSpacing:"0.1em",marginBottom:2}}>GAP</div>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:Number(gap)<=0?"#4ade80":"#f97316"}}>
                        {Number(gap)<=0?"✓ Met":"+"+gap+" pts"}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            {pointsData&&Number(gap)>0&&Number(gap)<=4&&(
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.gold}70`,marginTop:8,lineHeight:1.6}}>
                You're closer than you think. Every session moves the number.
              </div>
            )}
          </motion.div>
        )}

        <motion.div initial={{opacity:0,y:40}} animate={{opacity:1,y:0}} transition={{type:"spring",stiffness:260,damping:24,delay:0.1}} style={{
          background:"linear-gradient(170deg,#020C06 0%,#091508 45%,#020C06 100%)",
          border:`1px solid ${hasData&&pointsData?`${scoreColor}22`:T.border}`,
          borderRadius:24,marginBottom:16,overflow:"hidden",position:"relative",
          boxShadow:`0 0 0 1px ${hasData&&pointsData?`${scoreColor}09`:"transparent"},0 24px 64px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.04)`
        }}>

          {/* ── TOP ACCENT BAR ── */}
          <div style={{height:2,background:`linear-gradient(90deg,transparent 0%,${hasData&&pointsData?scoreColor:T.gold}70 35%,${hasData&&pointsData?scoreColor:T.gold} 50%,${hasData&&pointsData?scoreColor:T.gold}70 65%,transparent 100%)`}}/>

          {/* ── HEADER ── */}
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",padding:"18px 20px 0"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:`${T.gold}50`,letterSpacing:"0.25em",marginBottom:5}}>{heroTitle}</div>
              {uniData&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}65`,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{uniData.name} · {targetCourse.split("/")[0].trim()}</div>}
            </div>
            {statusInfo&&(
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,fontWeight:700,letterSpacing:"0.12em",color:statusInfo.color,background:`${statusInfo.color}12`,border:`1px solid ${statusInfo.color}30`,borderRadius:20,padding:"5px 11px",flexShrink:0,marginLeft:12}}>
                {statusInfo.label}
              </div>
            )}
          </div>

          {/* ── NO-DATA EMPTY STATE ── */}
          {!hasData?(
            <div style={{padding:"28px 20px 24px"}}>
              <div style={{display:"flex",justifyContent:"center",marginBottom:20}}>
                <div style={{position:"relative",width:224,height:224}}>
                  <svg width={224} height={224} style={{position:"absolute",inset:0,transform:"rotate(-90deg)"}}>
                    <circle cx={112} cy={112} r={96} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={16} strokeDasharray="8 6" strokeLinecap="round"/>
                  </svg>
                  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4}}>
                    <div style={{fontFamily:"'Playfair Display',serif",fontSize:52,fontWeight:900,color:`${T.gold}18`,lineHeight:1}}>0.0</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}35`,letterSpacing:"0.1em"}}>/ {targetPts} pts</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:`${T.muted}25`,letterSpacing:"0.12em",marginTop:2}}>NOT STARTED</div>
                  </div>
                </div>
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}55`,marginBottom:20,lineHeight:2,textAlign:"center"}}>
                {uniData
                  ?<>{uniData.shortName} {targetCourse.split("/")[0].trim()} requires <span style={{color:T.gold,fontWeight:700}}>{targetPts} pts</span>.<br/>Your score tracker builds after your first session.</>
                  :<>Your JUPEB score tracker builds as you practice.<br/><span style={{color:T.gold}}>First session unlocks everything.</span></>}
              </div>
              <button className="btn-press" onClick={()=>onNav("setup")} style={{width:"100%",minHeight:54,padding:"0 24px",border:"none",borderRadius:27,background:"linear-gradient(135deg,#004B3B 0%,#1B3A2A 50%,#8A6A1E 100%)",color:"#F7F3EC",fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:700,cursor:"pointer",boxShadow:"0 8px 28px rgba(0,75,59,0.45)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                Start First Session →
              </button>
            </div>
          ):(
            <>
              {/* ── RING ── */}
              <div style={{display:"flex",justifyContent:"center",padding:"22px 0 14px",position:"relative"}}>
                {/* Ambient glow */}
                <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",width:180,height:180,background:`radial-gradient(circle,${scoreColor}16 0%,transparent 70%)`,borderRadius:"50%",filter:"blur(28px)",pointerEvents:"none"}}/>

                <div style={{position:"relative",width:224,height:224}}>
                  <svg width={224} height={224} style={{position:"absolute",inset:0,transform:"rotate(-90deg)"}}>
                    <defs>
                      <linearGradient id="cqRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor={scoreColor} stopOpacity={0.45}/>
                        <stop offset="100%" stopColor={scoreColor} stopOpacity={1}/>
                      </linearGradient>
                    </defs>
                    {/* Track */}
                    <circle cx={112} cy={112} r={96} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={16}/>
                    {/* Quarter marks */}
                    {[0.25,0.5,0.75].map(t=>{
                      const a=t*2*Math.PI;
                      return <line key={t} x1={112+96*Math.cos(a)} y1={112+96*Math.sin(a)} x2={112+80*Math.cos(a)} y2={112+80*Math.sin(a)} stroke="rgba(255,255,255,0.1)" strokeWidth={1.5}/>;
                    })}
                    {/* Animated progress arc */}
                    <motion.circle cx={112} cy={112} r={96} fill="none" stroke="url(#cqRingGrad)" strokeWidth={16} strokeLinecap="round"
                      strokeDasharray={2*Math.PI*96}
                      initial={{strokeDashoffset:2*Math.PI*96}}
                      animate={{strokeDashoffset:2*Math.PI*96*(1-ringFrac)}}
                      transition={{duration:1.6,delay:0.4,ease:EASE}}
                    />
                    {/* Leading glow dot */}
                    {ringFrac>0.02&&ringFrac<0.98&&(
                      <motion.circle
                        cx={112+96*Math.cos(2*Math.PI*ringFrac-Math.PI/2)}
                        cy={112+96*Math.sin(2*Math.PI*ringFrac-Math.PI/2)}
                        r={7} fill={scoreColor}
                        initial={{opacity:0}} animate={{opacity:1}} transition={{delay:1.8}}
                        style={{filter:`drop-shadow(0 0 8px ${scoreColor})`}}
                      />
                    )}
                  </svg>

                  {/* Center text */}
                  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                    <motion.div initial={{scale:0.7,opacity:0}} animate={{scale:1,opacity:1}} transition={{type:"spring",stiffness:280,damping:20,delay:0.5}} style={{fontFamily:"'Playfair Display',serif",fontSize:54,fontWeight:900,lineHeight:0.9,letterSpacing:"-0.04em",color:scoreColor,textShadow:`0 0 40px ${scoreColor}45`,transition:"color 0.4s"}}>
                      {pointsData?displayPoints.toFixed(1):readiness}
                    </motion.div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}50`,letterSpacing:"0.08em",marginTop:10}}>
                      {pointsData?`/ ${targetPts} pts`:"% ready"}
                    </div>
                    {pointsData&&Number(gap)>0&&(
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:`${T.muted}32`,letterSpacing:"0.1em",marginTop:5}}>{Math.round(ringFrac*100)}% THERE</div>
                    )}
                    {pointsData&&Number(gap)<=0&&(
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"#4ade80",letterSpacing:"0.1em",marginTop:5,fontWeight:700}}>GOAL MET ✓</div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── PROGRESS + STATS ── */}
              {pointsData&&(
                <div style={{padding:"0 20px 20px"}}>
                  {/* Thin progress bar */}
                  <div style={{height:3,background:"rgba(255,255,255,0.05)",borderRadius:3,overflow:"hidden",marginBottom:16}}>
                    <motion.div initial={{width:0}} animate={{width:`${Math.min(100,ringFrac*100)}%`}} transition={{duration:1.5,delay:0.7,ease:EASE}}
                      style={{height:"100%",background:`linear-gradient(90deg,${scoreColor}60,${scoreColor})`,borderRadius:3}}/>
                  </div>

                  {/* Score — Gap pill — Required */}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                    <div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:`${T.muted}50`,letterSpacing:"0.14em",marginBottom:3}}>YOUR SCORE</div>
                      <div style={{display:"flex",alignItems:"baseline",gap:3}}>
                        <span style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:scoreColor,lineHeight:1}}>{displayPoints.toFixed(1)}</span>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}70`}}>pts</span>
                      </div>
                    </div>

                    {Number(gap)>0
                      ?<div style={{padding:"7px 14px",background:`${scoreColor}0E`,border:`1px solid ${scoreColor}28`,borderRadius:20,fontFamily:"'DM Mono',monospace",fontSize:9,color:scoreColor,fontWeight:700,letterSpacing:"0.04em"}}>+{gap} needed</div>
                      :<div style={{padding:"7px 14px",background:"rgba(74,222,128,0.08)",border:"1px solid rgba(74,222,128,0.22)",borderRadius:20,fontFamily:"'DM Mono',monospace",fontSize:9,color:"#4ade80",fontWeight:700}}>✓ Achieved</div>
                    }

                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:`${T.muted}50`,letterSpacing:"0.14em",marginBottom:3}}>REQUIRED</div>
                      <div style={{display:"flex",alignItems:"baseline",gap:3,justifyContent:"flex-end"}}>
                        <span style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:T.gold,lineHeight:1}}>{targetPts}</span>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}70`}}>pts</span>
                      </div>
                    </div>
                  </div>

                  {/* Status message */}
                  {statusInfo&&(
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:600,color:statusInfo.color,textAlign:"center",letterSpacing:"0.03em",padding:"9px 12px",background:`${statusInfo.color}08`,border:`1px solid ${statusInfo.color}16`,borderRadius:9}}>
                      {statusInfo.msg}
                    </div>
                  )}
                </div>
              )}

              {/* ── FASTEST ROUTE ── */}
              {fastestRoute.length>=2&&(
                <div style={{margin:"0 20px 20px",padding:"10px 14px",background:"rgba(255,255,255,0.02)",border:`1px solid rgba(255,255,255,0.06)`,borderRadius:10,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:`${T.muted}40`,letterSpacing:"0.18em",flexShrink:0,marginRight:4}}>FASTEST ROUTE</span>
                  {fastestRoute.slice(0,3).map((r,i)=>(
                    <span key={r.subject} style={{display:"inline-flex",alignItems:"center",gap:6}}>
                      {i>0&&<span style={{color:`${T.muted}28`,fontSize:10}}>→</span>}
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:i===0?T.gold:`${T.muted}75`,fontWeight:i===0?700:400}}>{r.subject}</span>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </motion.div>

        {/* ── TODAY'S MOVE — multi-topic fastest path ── */}
        {hasData&&missionList.length>0&&(
          <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.4,delay:subjStagger,ease:EASE}} style={{marginBottom:16}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.gold}60`,letterSpacing:"0.2em",marginBottom:8,paddingLeft:2}}>⚡ TODAY'S MOVE</div>
            <div style={{background:dark?"rgba(184,151,62,0.05)":"rgba(184,151,62,0.07)",border:`1.5px solid rgba(184,151,62,0.25)`,borderRadius:16,padding:"18px 18px 16px"}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.gold,marginBottom:14,minHeight:14}}>
                {typedText}{typedText.length<coachMsg.length&&<span style={{animation:"blink 0.8s step-end infinite"}}>▋</span>}
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}60`,letterSpacing:"0.18em",marginBottom:8}}>FASTEST PATH</div>
              {missionList.map((m,i)=>(
                <div key={m.topic} style={{marginBottom:i<missionList.length-1?10:0,padding:"10px 12px",background:"rgba(0,0,0,0.12)",borderRadius:10,border:`1px solid ${m.isPreferred?"rgba(184,151,62,0.2)":T.border}`}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:m.isPreferred?T.gold:T.muted,letterSpacing:"0.1em",marginBottom:2}}>{m.subject.toUpperCase()}{m.isPreferred?" ★":""}</div>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.topic}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0,marginLeft:12}}>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:900,color:"#4ade80"}}>+{m.pointPotential}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:`${T.muted}70`,letterSpacing:"0.08em"}}>PTS POTENTIAL</div>
                    </div>
                  </div>
                  {m.accuracy!==null&&(
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}70`}}>
                      Your accuracy: <span style={{color:"#f97316"}}>{m.accuracy}%</span>
                      <span style={{color:`${T.muted}50`}}> → target </span>
                      <span style={{color:"#4ade80"}}>60%</span>
                      {m.isPreferred&&uniData&&<span style={{color:`${T.gold}80`}}> · {uniData.shortName} priority subject</span>}
                    </div>
                  )}
                </div>
              ))}
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}60`,margin:"12px 0",textAlign:"center"}}>
                15 questions · ~25 min · start with {missionList[0]?.subject}
              </div>
              <motion.button whileTap={{scale:0.97}} onClick={()=>user?.isPremium?onNav("drill"):onUpgrade()}
                style={{width:"100%",minHeight:52,padding:"0 24px",border:"none",borderRadius:26,
                  background:"linear-gradient(135deg,#004B3B 0%,#1B3A2A 50%,#8A6A1E 100%)",
                  color:"#F7F3EC",fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,
                  cursor:"pointer",boxShadow:"0 4px 20px rgba(0,75,59,0.4)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                {user?.isPremium?"Fix Topic →":"Unlock & Fix Topic →"}
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ── YOUR BIGGEST BATTLES ── */}
        {hasData&&blockersBySubject.length>0&&(
          <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.4,delay:subjStagger+0.1,ease:EASE}} style={{marginBottom:16}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,letterSpacing:"0.2em",marginBottom:8,paddingLeft:2}}>YOUR BIGGEST BATTLES</div>
            {blockersBySubject.map((sb,si)=>{
              const meta=SUBJECT_META[sb.subject]||{icon:"BKS",color:T.gold};
              return (
                <div key={sb.subject} style={{marginBottom:si<blockersBySubject.length-1?8:0,background:T.surface,border:`1px solid ${T.border}`,borderLeft:"3px solid rgba(239,68,68,0.45)",borderRadius:12,padding:"12px 14px 10px"}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"rgba(239,68,68,0.6)",letterSpacing:"0.14em",marginBottom:8}}>🔥 {sb.subject.toUpperCase()}</div>
                  {sb.blockers.map((b,bi)=>(
                    <div key={b.topic} style={{marginBottom:bi<sb.blockers.length-1?10:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                        <span style={{fontSize:11}}>{bi===0?"🔥":"⚡"}</span>
                        <span style={{fontSize:13,color:T.text,fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.topic}</span>
                      </div>
                      <div style={{display:"flex",gap:14,fontFamily:"'DM Mono',monospace",fontSize:9,alignItems:"center"}}>
                        <span><span style={{color:"#f97316",fontWeight:700}}>{b.accuracy}%</span><span style={{color:`${T.muted}80`}}> → </span><span style={{color:"#4ade80",fontWeight:700}}>60%</span></span>
                        <span><span style={{color:`${T.muted}80`}}>Reward: </span><span style={{color:T.gold,fontWeight:700}}>+{Math.max(1,Math.round(b.costPct/2))} marks</span></span>
                      </div>
                    </div>
                  ))}
                  <motion.button whileTap={{scale:0.97}} onClick={()=>user?.isPremium?onNav("drill"):onUpgrade()}
                    style={{marginTop:10,width:"100%",minHeight:52,padding:"0 18px",border:"1px solid rgba(239,68,68,0.2)",borderRadius:26,background:"rgba(239,68,68,0.05)",color:"#ef4444",fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer",letterSpacing:"0.08em",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {user?.isPremium?"15 questions today →":"Fix this →"}
                  </motion.button>
                </div>
              );
            })}
          </motion.div>
        )}

        </div>{/* ← END LEFT COLUMN */}
        <div className={isDesktop?"cq-dash-col":""}>{/* ← RIGHT COLUMN: subjects + actions */}

        {/* ── SUBJECT BREAKDOWN ROWS ── */}
        {userSubjects.length>0&&(
          <div style={{marginBottom:16}}>
            {subjectRows.map((row,i)=>{
              const meta=SUBJECT_META[row.subject]||{icon:"BKS",color:T.gold};
              const g=row.gradeData;
              const isExpanded=expandedSubject===row.subject;
              const subBlockers=blockersBySubject.find(b=>b.subject===row.subject);
              const rowDelay=0.35+i*0.08;
              return (
                <motion.div key={row.subject} initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.4,delay:rowDelay,ease:EASE}}
                  style={{marginBottom:i<subjectRows.length-1?8:0}}>
                  {/* Row */}
                  <motion.div whileTap={{scale:0.97}} onClick={()=>setExpandedSubject(isExpanded?null:row.subject)}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",cursor:"pointer",
                      background:isExpanded?`${meta.color}10`:T.surface,
                      border:`1px solid ${isExpanded?`${meta.color}40`:T.border}`,
                      borderRadius:isExpanded?"12px 12px 0 0":12,
                      transition:"background 0.2s,border 0.2s"}}>
                    <SubjectBadge code={meta.icon} color={meta.color} size={16}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:row.sessions>0?5:2}}>
                        <span style={{fontSize:13,color:T.text,fontWeight:500}}>{row.subject}</span>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,flexShrink:0,
                          color:(fastestRoute[0]&&fastestRoute[0].subject===row.subject&&row.sessions>0)?T.gold:`${T.muted}99`,
                          fontWeight:(fastestRoute[0]&&fastestRoute[0].subject===row.subject&&row.sessions>0)?700:400}}>
                          {subjectStory(row)}
                        </span>
                      </div>
                      {row.sessions>0?(
                        <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden"}}>
                          <motion.div initial={{width:0}} animate={{width:`${Math.min(100,row.avg||0)}%`}} transition={{duration:1,delay:rowDelay+0.3,ease:EASE}}
                            style={{height:"100%",background:g?g.color:meta.color,borderRadius:2}}/>
                        </div>
                      ):(
                        <div className="skeleton" style={{height:3,width:"55%",borderRadius:2}}/>
                      )}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                      {g?(
                        <motion.div initial={{scale:0.4,opacity:0}} animate={{scale:1,opacity:1}} transition={{type:"spring",stiffness:380,damping:14,delay:rowDelay+0.25}}
                          style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:900,color:g.color,minWidth:22,textAlign:"center"}}>{g.grade}</motion.div>
                      ):(
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.gold}44`,letterSpacing:"0.06em"}}>START</div>
                      )}
                      <ChevronRight size={13} color={`${T.muted}55`} style={{transition:"transform 0.2s",transform:isExpanded?"rotate(90deg)":"none"}}/>
                    </div>
                  </motion.div>
                  {isExpanded&&(
                    <div style={{background:`${meta.color}06`,border:`1px solid ${meta.color}30`,borderTop:"none",borderRadius:"0 0 12px 12px",padding:"14px 14px 12px"}}>
                      {row.sessions>0?(
                        <>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                            <div>
                              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,letterSpacing:"0.1em",marginBottom:3}}>ESTIMATED GRADE</div>
                              <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:g?g.color:T.muted,lineHeight:1}}>{g?g.grade:"—"}</div>
                            </div>
                            {g&&g.grade!=="A"&&(
                              <div style={{textAlign:"right"}}>
                                <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,letterSpacing:"0.08em",marginBottom:3}}>TO REACH {g.grade==="C"||g.grade==="D"||g.grade==="F"?"B":"A"}</div>
                                <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,fontWeight:700,color:T.gold}}>+{Math.max(0,(g.grade==="B"?70:60)-(row.avg||0))}% accuracy</div>
                              </div>
                            )}
                          </div>
                          {subBlockers&&subBlockers.blockers.length>0&&(
                            <div style={{marginBottom:10}}>
                              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"rgba(239,68,68,0.55)",letterSpacing:"0.12em",marginBottom:6}}>TOPIC MAP</div>
                              {subBlockers.blockers.map((b,bi)=>(
                                <div key={b.topic} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,padding:"6px 8px",background:`rgba(239,68,68,${bi===0?0.05:0.02})`,borderRadius:6}}>
                                  <span style={{fontSize:10}}>{bi===0?"🔴":"🟡"}</span>
                                  <span style={{fontSize:11,color:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.topic}</span>
                                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:bi===0?"#ef4444":"#f97316",flexShrink:0}}>{b.accuracy}%</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <button className="btn-press" onClick={e=>{e.stopPropagation();user?.isPremium?onNav("drill"):onUpgrade();}}
                            style={{width:"100%",padding:"9px",border:`1px solid ${meta.color}35`,borderRadius:7,background:`${meta.color}10`,color:meta.color,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer",letterSpacing:"0.08em"}}>
                            PRACTICE {row.subject.toUpperCase().slice(0,14)} →
                          </button>
                        </>
                      ):(
                        <div style={{textAlign:"center",padding:"6px 0"}}>
                          <button className="btn-press" onClick={e=>{e.stopPropagation();onNav("setup");}}
                            style={{padding:"10px 28px",border:`1px solid ${meta.color}35`,borderRadius:8,background:`${meta.color}10`,color:meta.color,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer",letterSpacing:"0.06em"}}>
                            Start {row.subject} →
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        {/* ── IMPROVING TOPICS SIGNAL ── */}
        {fastestImprovement&&fastestImprovement.delta>=8&&(
          <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:0.35,delay:0.3,ease:EASE}}
            style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",marginBottom:12,background:"rgba(74,222,128,0.06)",border:"1px solid rgba(74,222,128,0.2)",borderRadius:10}}>
            <div style={{fontSize:16}}>↑</div>
            <div style={{flex:1}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#4ade80",fontWeight:700}}>{fastestImprovement.topic} moving</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}80`}}>+{fastestImprovement.delta}% improvement across recent sessions</div>
            </div>
          </motion.div>
        )}

        {/* ── CBT READY ── */}
        {hasData&&(
          <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.4,delay:subjStagger+0.18,ease:EASE}} style={{marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:12}}>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,letterSpacing:"0.14em",marginBottom:4}}>CBT READY</div>
                {latestCBT?(
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,fontWeight:700,color:T.text}}>
                    Last sim: {latestCBT.pct}% · {latestCBT.grade}
                  </div>
                ):(
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:`${T.muted}88`}}>No simulation yet</div>
                )}
              </div>
              <motion.button whileTap={{scale:0.96}} onClick={()=>onNav("setup")} style={{minHeight:40,padding:"0 18px",border:`1px solid ${T.gold}40`,borderRadius:24,background:`${T.gold}12`,color:T.gold,fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,cursor:"pointer",letterSpacing:"0.06em",whiteSpace:"nowrap",flexShrink:0,marginLeft:12,display:"flex",alignItems:"center"}}>
                {latestCBT?"Retake →":"Simulate →"}
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ── COMPETITION POSITION ── */}
        {competitionData&&(competitionData.percentile!==null||competitionData.total>=2)&&(
          <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.4,ease:EASE}} style={{marginBottom:16}}>
            <div style={{padding:"14px 16px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:12}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}60`,letterSpacing:"0.18em",marginBottom:8}}>
                AMONG {competitionData.shortName||""} {competitionData.course||""} STUDENTS
              </div>
              {competitionData.percentile!==null?(
                <>
                  <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:4}}>
                    <div style={{fontFamily:"'Playfair Display',serif",fontSize:32,fontWeight:900,color:competitionData.percentile>=60?"#4ade80":competitionData.percentile>=40?T.gold:"#f97316"}}>
                      {competitionData.percentile}%
                    </div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>ahead of peers</div>
                  </div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}70`}}>
                    Based on {competitionData.total} students on CrediQ targeting {competitionData.shortName} {competitionData.course}
                  </div>
                </>
              ):(
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>
                  {competitionData.total} student{competitionData.total!==1?"s":""} on CrediQ targeting your goal. Rankings unlock as more students join.
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── REVIEW NEEDED ── */}
        {reviewQueue.length>0&&(
          <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.4,delay:subjStagger+0.26,ease:EASE}} style={{marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 14px",background:T.surface,border:`1px solid ${T.border}`,borderLeft:"3px solid #f97316",borderRadius:12}}>
              <div style={{minWidth:0}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"rgba(249,115,22,0.6)",letterSpacing:"0.14em",marginBottom:4}}>REVIEW NEEDED</div>
                <div style={{fontSize:13,color:T.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {reviewQueue[0].subject?`${reviewQueue[0].subject} · `:""}{reviewQueue[0].topic}
                </div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#f97316",marginTop:2}}>
                  {reviewQueue[0].dueIn===0?"Due today":`${Math.abs(reviewQueue[0].dueIn)}d overdue`}
                  {reviewQueue.length>1&&<span style={{color:T.muted,marginLeft:8}}>+{reviewQueue.length-1} more</span>}
                </div>
              </div>
              <motion.button whileTap={{scale:0.96}} onClick={()=>user?.isPremium?onNav("drill"):onUpgrade()} style={{minHeight:40,padding:"0 16px",border:"1px solid rgba(249,115,22,0.3)",borderRadius:24,background:"rgba(249,115,22,0.08)",color:"#f97316",fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,cursor:"pointer",letterSpacing:"0.06em",flexShrink:0,marginLeft:12,display:"flex",alignItems:"center"}}>
                Review →
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ── START PRACTICE button (visible when no today's mission yet) ── */}
        {hasData&&!todayMission&&(
          <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.4,delay:subjStagger,ease:EASE}} style={{marginBottom:16}}>
            <motion.button whileTap={{scale:0.97}} onClick={()=>onNav("setup")}
              style={{width:"100%",minHeight:52,padding:"0 24px",border:`1px solid ${T.border}`,borderRadius:26,background:T.surface,color:T.text,fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
              Continue Practice →
            </motion.button>
          </motion.div>
        )}

        </div>{/* ← END RIGHT COLUMN */}
        </div>{/* ← END DESKTOP GRID */}

      </div>
    </div>
  );
}

// ─── SETUP SCREEN (lazy loads questions) ─────────────────────────────────────
function SetupScreen({user,QB,onStart,onBack,onRetryLoad,dark,setDark,T}) {
  const userSubjects=user.subjects||[];
  const [subject,setSubject]=useState(()=>userSubjects[0]||"mixed");
  const [courseUnit,setCourseUnit]=useState(null); // null = all units
  const [year,setYear]=useState("all");
  const [mode,setMode]=useState("full");

  const subjectCourses=subject!=="mixed"?(JUPEB_COURSES[subject]||[]):[];

  // When subject changes, reset course unit and year
  const pickSubject=sub=>{setSubject(sub);setCourseUnit(null);setYear("all");};

  const getPool=()=>{
    if(subject==="mixed")return getMixedExam(QB,userSubjects,mode==="full"?50:20);
    let qs;
    if(courseUnit){
      qs=getQuestionsForCourse(QB,subject,courseUnit);
    } else {
      qs=year==="all"?getAllQuestionsForSubject(QB,subject):getQuestions(QB,subject,Number(year));
    }
    return [...qs].sort(()=>Math.random()-0.5).slice(0,mode==="full"?50:20);
  };

  const availYears=subject!=="mixed"&&!courseUnit?["all",...new Set(getAllQuestionsForSubject(QB,subject).map(q=>String(q.year)))].sort():[];
  const qCount=(()=>{
    if(subject==="mixed")return Math.min(mode==="full"?50:20,getMixedExam(QB,userSubjects,999).length);
    if(courseUnit){const a=getQuestionsForCourse(QB,subject,courseUnit);return Math.min(mode==="full"?50:20,a.length);}
    const a=year==="all"?getAllQuestionsForSubject(QB,subject):getQuestions(QB,subject,Number(year));
    return Math.min(mode==="full"?50:20,a.length);
  })();
  const modes=[
    {key:"full",label:"Full JUPEB Simulation",sub:`${Math.min(50,qCount)}q · 60 minutes`,desc:"Real CBT conditions. 72 seconds per question — exam pace.",time:60},
    {key:"quick",label:"Quick Practice",sub:`${Math.min(20,qCount)}q · 25 minutes`,desc:"Focused revision. Great for daily practice.",time:25},
  ];

  // Fix 5: track QB load timeout so we can offer a retry button
  const [loadTimeout,setLoadTimeout]=useState(false);
  useEffect(()=>{
    if(Object.keys(QB).length){setLoadTimeout(false);return;}
    const t=setTimeout(()=>setLoadTimeout(true),15000);
    return()=>clearTimeout(t);
  },[QB]);

  // Empty QB state
  if(!Object.keys(QB).length){
    return (
      <div style={{minHeight:"100dvh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,padding:20}}>
        <Logo size={26} onDark={dark}/>
        {loadTimeout?(
          <>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textAlign:"center"}}>Taking longer than usual.</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}88`,textAlign:"center"}}>This can happen on slow connections.<br/>Check your data and try again.</div>
            <button onClick={()=>{setLoadTimeout(false);onRetryLoad&&onRetryLoad();}}
              style={{marginTop:4,padding:"12px 28px",border:`1px solid ${T.gold}`,borderRadius:24,background:"transparent",
                color:T.gold,fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer",letterSpacing:"0.08em"}}>
              Retry →
            </button>
            <button onClick={onBack} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:9}}>← Back</button>
          </>
        ):(
          <>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textAlign:"center"}}>Loading your questions…</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}88`,textAlign:"center"}}>First load may take a moment.<br/>Questions will be cached for instant access next time.</div>
            <div style={{display:"flex",gap:6}}>{[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:T.gold,animation:`blink 1.2s ${i*0.2}s ease-in-out infinite`}}/>)}</div>
            <button onClick={onBack} style={{marginTop:8,background:"none",border:"none",color:T.muted,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:9}}>← Back</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,paddingBottom:40}}>
      <div style={{background:T.navBg,padding:"20px 22px 16px",borderBottom:`1px solid ${T.navBorder}`}}>
        <div style={{maxWidth:1000,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button className="btn-press" onClick={onBack} style={{background:"none",border:"none",color:"rgba(247,243,236,0.5)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:10,padding:0,display:"flex",alignItems:"center",gap:4}}><ChevronLeft size={14}/> Back</button>
            <div style={{width:1,height:14,background:"rgba(255,255,255,0.1)"}}/>
            <Logo size={17} onDark={true}/>
          </div>
          <ThemeBtn dark={dark} setDark={setDark} T={T}/>
        </div>
        <div style={{marginTop:14}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:"#F7F3EC"}}>Take a Mock Exam</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.35)",letterSpacing:"0.08em",marginTop:3}}>4,413 real JUPEB questions · 2026 CBT format</div>
        </div>
      </div>
      <div style={{padding:"18px",maxWidth:1000,margin:"0 auto",width:"100%"}}>
        {/* Subject */}
        <div className="fi1" style={{marginBottom:20}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:10}}>SUBJECT</div>
          <div className="setup-subjects-grid" style={{display:"flex",flexDirection:"column",gap:7}}>
          <div className="btn-press" onClick={()=>{setSubject("mixed");setYear("all");}} style={{padding:"13px 15px",background:subject==="mixed"?"rgba(184,151,62,0.15)":T.surface,border:`1px solid ${subject==="mixed"?T.gold:T.border}`,borderRadius:9,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <Shuffle size={16} color={subject==="mixed"?T.gold:T.muted} strokeWidth={1.8}/>
              <div>
                <div style={{fontSize:14,color:T.text,fontWeight:subject==="mixed"?600:400}}>All Subjects Practice</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginTop:2}}>Warm-up only · Won't affect grade estimate</div>
              </div>
            </div>
            {subject==="mixed"&&<span style={{color:T.gold}}>✓</span>}
          </div>
          {userSubjects.map(sub=>{
            const meta=SUBJECT_META[sub]||{icon:"BKS",color:"#B8973E"};
            const cnt=getAllQuestionsForSubject(QB,sub).length;
            const hasDiagramNote=["Physics","Biology","Chemistry","Geography","Agricultural Science"].includes(sub);
            return (
              <div key={sub} className="btn-press" onClick={()=>pickSubject(sub)} style={{padding:"13px 15px",background:subject===sub?`${meta.color}15`:T.surface,border:`1px solid ${subject===sub?meta.color:T.border}`,borderRadius:9,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <SubjectBadge code={meta.icon} color={meta.color} size={18}/>
                  <div>
                    <div style={{fontSize:14,color:T.text,fontWeight:subject===sub?600:400}}>{sub}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginTop:2}}>{cnt} questions available{hasDiagramNote?" · diagram questions coming soon":""}</div>
                  </div>
                </div>
                {subject===sub&&<span style={{color:meta.color}}>✓</span>}
              </div>
            );
          })}
          </div>
        </div>

        {/* COURSE UNIT — shown only when a specific subject is selected */}
        {subject!=="mixed"&&subjectCourses.length>0&&(
          <div className="fi2" style={{marginBottom:20}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:10}}>COURSE UNIT</div>
            {/* All units option */}
            <div className="btn-press" onClick={()=>setCourseUnit(null)} style={{padding:"10px 14px",background:courseUnit===null?"rgba(184,151,62,0.1)":T.surface,border:`1px solid ${courseUnit===null?T.gold:T.border}`,borderRadius:8,cursor:"pointer",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:courseUnit===null?T.gold:T.text,fontWeight:courseUnit===null?700:400}}>All Units</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginLeft:10}}>Mix all 4 course units</span>
              </div>
              {courseUnit===null&&<span style={{color:T.gold,fontSize:12}}>✓</span>}
            </div>
            {subjectCourses.map(c=>{
              const cnt=getQuestionsForCourse(QB,subject,c.code).length;
              const active=courseUnit===c.code;
              return (
                <div key={c.code} className="btn-press" onClick={()=>{setCourseUnit(c.code);setYear("all");}} style={{padding:"10px 14px",background:active?`${SUBJECT_META[subject]?.color||T.gold}12`:T.surface,border:`1px solid ${active?SUBJECT_META[subject]?.color||T.gold:T.border}`,borderRadius:8,cursor:"pointer",marginBottom:6}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:2}}>
                        <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:active?SUBJECT_META[subject]?.color||T.gold:T.gold,fontWeight:700}}>{c.code}</span>
                        <span style={{fontSize:12,color:T.text,fontWeight:active?600:400}}>{c.name}</span>
                      </div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{c.desc}</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:8,flexShrink:0}}>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{cnt}q</span>
                      {active&&<span style={{color:SUBJECT_META[subject]?.color||T.gold,fontSize:12}}>✓</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* YEAR — only shown when All Units selected (course units span all years) */}
        {subject!=="mixed"&&!courseUnit&&(
          <div className="fi3" style={{marginBottom:20}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:10}}>YEAR</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {availYears.map(y=>(
                <div key={y} className="btn-press" onClick={()=>setYear(y)} style={{padding:"10px 18px",background:y===year?T.gold:T.surface,border:`1px solid ${y===year?T.gold:T.border}`,borderRadius:8,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11,color:y===year?T.bg:T.text,fontWeight:y===year?700:400}}>
                  {y==="all"?"All Years":y}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="fi4" style={{marginBottom:24}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:10}}>EXAM MODE</div>
          {modes.map(m=>(
            <div key={m.key} className="btn-press" onClick={()=>setMode(m.key)} style={{padding:"13px 15px",background:mode===m.key?"rgba(184,151,62,0.1)":T.surface,border:`1px solid ${mode===m.key?T.gold:T.border}`,borderRadius:9,cursor:"pointer",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:14,color:T.text,fontWeight:mode===m.key?600:400}}>{m.label}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.gold,marginTop:3}}>{m.sub}</div>
                </div>
                {mode===m.key&&<span style={{color:T.gold}}>✓</span>}
              </div>
              <div style={{fontSize:12,color:T.muted,marginTop:6}}>{m.desc}</div>
            </div>
          ))}
        </div>

        {/* Theory Questions — Coming Soon */}
        <div style={{marginBottom:24,padding:"13px 15px",background:T.surface,border:`1px dashed ${T.border}`,borderRadius:9,opacity:0.55,cursor:"default"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:14,color:T.muted,fontWeight:400}}>Theory Questions</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}60`,marginTop:3}}>Essay · Short Answer · Structured</div>
            </div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.gold,letterSpacing:"0.12em",background:"rgba(184,151,62,0.08)",border:"1px solid rgba(184,151,62,0.2)",borderRadius:12,padding:"3px 9px",flexShrink:0}}>COMING SOON</div>
          </div>
        </div>

        {qCount===0?(
          <div style={{background:`${T.danger}08`,border:`1px solid ${T.danger}25`,borderRadius:10,padding:"16px 18px",textAlign:"center"}}>
            <AlertCircle size={20} color={T.danger} style={{margin:"0 auto 8px"}}/>
            <div style={{fontSize:13,color:T.text,fontWeight:500,marginBottom:4}}>No questions for this selection.</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>Try "All Years" or a different subject.</div>
          </div>
        ):(
          <BtnPrimary onClick={()=>{const qs=getPool();if(!qs.length)return;const tl=modes.find(m2=>m2.key===mode)?.time||60;track("exam_started",{uid:user.uid,subject,year,mode,questionCount:qs.length});onStart({questions:qs,subject,year,mode,timeLimit:tl,startTime:Date.now()});}} T={T}>
            Begin CBT Simulation — {qCount} Questions
          </BtnPrimary>
        )}
      </div>
    </div>
  );
}

// ─── SCIENTIFIC CALCULATOR ────────────────────────────────────────────────────
function ScientificCalc({T,onClose}){
  const[display,setDisplay]=useState("0");
  const[expr,setExpr]=useState("");
  const[justEvaled,setJustEvaled]=useState(false);
  const[deg,setDeg]=useState(true);
  const toRad=v=>deg?v*(Math.PI/180):v;

  const press=btn=>{
    if(btn==="AC"){setDisplay("0");setExpr("");setJustEvaled(false);return;}
    if(btn==="⌫"){
      if(justEvaled){setDisplay("0");setExpr("");setJustEvaled(false);return;}
      const nd=display.slice(0,-1)||"0";setDisplay(nd);setExpr(e=>e.slice(0,-1));return;
    }
    if(btn==="="){
      try{
        let ev=expr
          .replace(/×/g,"*").replace(/÷/g,"/")
          .replace(/sin\(/g,"Math.sin(toRad(").replace(/cos\(/g,"Math.cos(toRad(")
          .replace(/tan\(/g,"Math.tan(toRad(").replace(/log\(/g,"Math.log10(")
          .replace(/ln\(/g,"Math.log(").replace(/√\(/g,"Math.sqrt(")
          .replace(/π/g,"Math.PI").replace(/e(?![0-9])/g,"Math.E").replace(/\^/g,"**")
          .replace(/(\d+)\(/g,"$1*(");
        const extra=(expr.match(/sin\(|cos\(|tan\(|log\(|ln\(|√\(/g)||[]).length;
        ev+=")".repeat(extra);
        // eslint-disable-next-line no-new-func
        const res=Function("toRad",`"use strict";return (${ev})`)(toRad);
        const fmt=n=>{if(!isFinite(n))return"Error";if(Number.isInteger(n)&&Math.abs(n)<1e15)return String(n);return String(parseFloat(n.toPrecision(10)));};
        const r=fmt(res);setDisplay(r);setExpr(r);setJustEvaled(true);
      }catch{setDisplay("Error");setExpr("");setJustEvaled(true);}
      return;
    }
    if(btn==="±"){const n=parseFloat(display);if(!isNaN(n)){const neg=String(-n);setDisplay(neg);setExpr(e=>e.endsWith(display)?e.slice(0,-display.length)+neg:neg);}return;}
    if(btn==="%"){const n=parseFloat(display);if(!isNaN(n)){const p=String(n/100);setDisplay(p);setExpr(p);}return;}
    if(justEvaled&&!["÷","×","-","+","^"].includes(btn)){setDisplay(btn);setExpr(btn);setJustEvaled(false);return;}
    setJustEvaled(false);
    const sym={"sin(":"sin(","cos(":"cos(","tan(":"tan(","log(":"log(","ln(":"ln(","√(":"√(","π":"π","e":"e","x²":"^2"}[btn]??btn;
    setDisplay(["÷","×","-","+","^","("].includes(sym)?sym:display===("0")&&/\d/.test(sym)?sym:display+sym);
    setExpr(e=>e+sym);
  };

  const Btn=({label,span=1,color,bg,accent})=>(
    <button onClick={()=>press(label)} style={{
      gridColumn:`span ${span}`,padding:"16px 0",minHeight:52,
      border:accent?`1px solid rgba(184,151,62,0.28)`:`1px solid ${T.border}`,
      borderRadius:10,cursor:"pointer",
      background:bg||(accent?"rgba(184,151,62,0.1)":T.surface),
      color:color||T.text,
      fontFamily:"'DM Mono',monospace",
      fontSize:label.length>3?11:15,fontWeight:600,
      transition:"opacity 0.1s"
    }}>{label}</button>
  );

  return(
    <div style={{position:"fixed",inset:0,zIndex:700,display:"flex",alignItems:"flex-end",justifyContent:"center",background:"rgba(0,0,0,0.72)",backdropFilter:"blur(4px)"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <motion.div initial={{y:420,opacity:0}} animate={{y:0,opacity:1}} exit={{y:420,opacity:0}} transition={{type:"spring",stiffness:280,damping:28}}
        style={{width:"100%",maxWidth:480,background:T.bg,borderRadius:"20px 20px 0 0",boxShadow:"0 -20px 60px rgba(0,0,0,0.5)",paddingBottom:"env(safe-area-inset-bottom,0px)"}}>
        {/* Handle */}
        <div style={{display:"flex",justifyContent:"center",padding:"10px 0 2px"}}>
          <div style={{width:36,height:4,borderRadius:2,background:`${T.muted}28`}}/>
        </div>
        {/* Topbar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 16px 8px"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}55`,letterSpacing:"0.18em"}}>SCIENTIFIC CALCULATOR</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={()=>setDeg(d=>!d)} style={{fontFamily:"'DM Mono',monospace",fontSize:9,padding:"4px 10px",border:`1px solid ${T.border}`,borderRadius:12,background:deg?"rgba(184,151,62,0.12)":"transparent",color:deg?T.gold:T.muted,cursor:"pointer"}}>{deg?"DEG":"RAD"}</button>
            <button onClick={onClose} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:20,lineHeight:1,padding:4}}>✕</button>
          </div>
        </div>
        {/* Display */}
        <div style={{margin:"0 14px 10px",padding:"10px 16px 12px",background:"rgba(0,0,0,0.25)",borderRadius:12,border:`1px solid ${T.border}`,textAlign:"right"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:`${T.muted}45`,minHeight:16,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{expr||"‎"}</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:38,fontWeight:700,color:T.text,lineHeight:1.1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{display}</div>
        </div>
        {/* Keys */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,padding:"0 14px 16px"}}>
          <Btn label="sin(" accent/><Btn label="cos(" accent/><Btn label="tan(" accent/><Btn label="π" accent/>
          <Btn label="log(" accent/><Btn label="ln(" accent/><Btn label="√(" accent/><Btn label="^" accent/>
          <Btn label="x²" accent/><Btn label="e" accent/><Btn label="(" accent/><Btn label=")" accent/>
          <Btn label="AC" color={T.danger}/><Btn label="±"/><Btn label="%"/><Btn label="÷" color={T.gold}/>
          <Btn label="7"/><Btn label="8"/><Btn label="9"/><Btn label="×" color={T.gold}/>
          <Btn label="4"/><Btn label="5"/><Btn label="6"/><Btn label="-" color={T.gold}/>
          <Btn label="1"/><Btn label="2"/><Btn label="3"/><Btn label="+" color={T.gold}/>
          <Btn label="⌫"/><Btn label="0"/><Btn label="."/>
          <Btn label="=" bg="linear-gradient(135deg,#004B3B,#8A6A1E)" color="#F7F3EC"/>
        </div>
      </motion.div>
    </div>
  );
}

// ─── EXAM SCREEN ──────────────────────────────────────────────────────────────
function ExamScreen({config,user,onEnd,onQuit,onLimitHit,dark,setDark,T,navOffset=0}) {
  const {questions,subject,year,mode,timeLimit,startTime}=config;
  const [current,setCurrent]=useState(0);
  const [answers,setAnswers]=useState({});
  const [timeLeft,setTimeLeft]=useState(timeLimit*60);
  const [showNav,setShowNav]=useState(false);
  const [showQuit,setShowQuit]=useState(false);
  const [showReport,setShowReport]=useState(false);
  const [showCalc,setShowCalc]=useState(false);
  const [lastAnswer,setLastAnswer]=useState(null);
  const timerRef=useRef(null);
  const answersRef=useRef(answers);
  const totalQ=questions.length;

  // Keep answersRef current so the auto-submit timer always reads latest answers
  useEffect(()=>{answersRef.current=answers;},[answers]);

  const fmt=s=>`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const q=questions[current];
  const answeredCount=Object.keys(answers).length;
  const isWarning=timeLeft<300&&timeLeft>=60,isUrgent=timeLeft<60;
  const timerColor=isUrgent?T.danger:isWarning?T.warn:T.gold;
  const timerClass=isUrgent?"timer-urgent":isWarning?"timer-fast":"timer-pulse";

  // Keep a ref to user.uid so handleSubmit never needs user in its deps (prevents timer jitter)
  const userUidRef=useRef(user?.uid);
  useEffect(()=>{userUidRef.current=user?.uid;},[user?.uid]);

  // handleSubmit reads from ref so it's safe to call from stale closures (e.g. timer)
  const handleSubmit=useCallback(()=>{
    clearInterval(timerRef.current);
    const latestAnswers=answersRef.current;
    const duration=Math.round((Date.now()-startTime)/1000);
    let correct=0;const wrongTopics=[];
    const qResults=questions.map((q,i)=>{
      const ua=latestAnswers[i];const ok=ua===q.correctAnswer;
      if(ok)correct++;else if(q.topic)wrongTopics.push(q.topic);
      return{questionId:q.id,question:q.question,topic:q.topic,correct:ok,userAnswer:ua||null,correctAnswer:q.correctAnswer,explanation:q.explanation||""};
    });
    const total=questions.length,pct=Math.round((correct/total)*100);
    track("exam_completed",{uid:userUidRef.current,subject,pct,grade:grade(pct),duration});
    onEnd({subject:subject==="mixed"?"Mixed":subject,year:year==="all"?"All Years":year,mode,correct,total,pct,grade:grade(pct),wrongTopics:[...new Set(wrongTopics)],questionResults:qResults,duration,date:new Date().toISOString()});
  },[questions,subject,year,mode,startTime,onEnd]);

  useEffect(()=>{
    timerRef.current=setInterval(()=>setTimeLeft(t=>{if(t<=1){clearInterval(timerRef.current);handleSubmit();return 0;}return t-1;}),1000);
    return()=>clearInterval(timerRef.current);
  },[handleSubmit]);

  const handleAnswer=opt=>{
    const isNew=answers[current]===undefined;
    // Mid-exam limit check — only applies to drill mode (mock exams are free diagnostic, never interrupted)
    if(!user?.isPremium&&isNew&&mode==="drill"){
      const usedSoFar=(user?.questionsToday||0)+Object.keys(answers).length+1;
      if(usedSoFar>FREE_DAILY_LIMIT){
        clearInterval(timerRef.current);
        const finalAnswers={...answers,[current]:opt};
        const duration=Math.round((Date.now()-startTime)/1000);
        let correct=0;const wrongTopics=[];
        const qResults=Object.entries(finalAnswers)
          .sort((a,b)=>parseInt(a[0])-parseInt(b[0]))
          .map(([idx,ua])=>{
            const q=questions[parseInt(idx)];
            const ok=ua===q.correctAnswer;
            if(ok)correct++;else if(q.topic)wrongTopics.push(q.topic);
            return{questionId:q.id,question:q.question,topic:q.topic,correct:ok,userAnswer:ua,correctAnswer:q.correctAnswer,explanation:q.explanation||"",timeSpent:0};
          });
        const total=qResults.length;
        const pct=Math.round((correct/total)*100);
        onLimitHit&&onLimitHit({
          subject:subject==="mixed"?"Mixed":subject,
          year:year==="all"?"All Years":year,
          mode,correct,total,pct,grade:grade(pct),
          wrongTopics:[...new Set(wrongTopics)],
          questionResults:qResults,
          duration,date:new Date().toISOString(),hitLimit:true,
        });
        return;
      }
    }
    setAnswers(a=>({...a,[current]:opt}));
    setLastAnswer(opt);
    setTimeout(()=>setLastAnswer(null),300);
    // Only auto-advance on FIRST answer — allow changes before moving on
    if(isNew&&current<totalQ-1)setTimeout(()=>setCurrent(c=>c+1),500);
  };

  return (
    <div style={{minHeight:"100dvh",background:T.bg,color:T.text,display:"flex",flexDirection:"column"}}>
      {showQuit&&<ConfirmQuit onConfirm={()=>{clearInterval(timerRef.current);track("exam_abandoned",{uid:user?.uid});onQuit();}} onCancel={()=>setShowQuit(false)} answered={answeredCount} total={totalQ} T={T}/>}
      {showReport&&<ReportModal question={q} user={user} onClose={()=>setShowReport(false)} onSubmit={data=>track("question_reported",{uid:user?.uid,...data})} T={T}/>}
      <AnimatePresence>{showCalc&&<ScientificCalc T={T} onClose={()=>setShowCalc(false)}/>}</AnimatePresence>

      {/* Header */}
      <div style={{background:T.navBg,padding:"14px 18px",borderBottom:`1px solid ${T.navBorder}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,zIndex:10}}>
        <button className="btn-press" onClick={()=>setShowQuit(true)} style={{background:"none",border:"none",color:"rgba(247,243,236,0.4)",cursor:"pointer",padding:4,display:"flex",alignItems:"center",gap:3}}>
          <ChevronLeft size={16}/><span style={{fontFamily:"'DM Mono',monospace",fontSize:9}}>QUIT</span>
        </button>
        <div style={{textAlign:"center"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.4)"}}>{subject==="mixed"?"ALL SUBJECTS":subject==="drill"?"DRILL":subject.toUpperCase()}</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(247,243,236,0.5)"}}>Q{current+1}/{totalQ}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button className="btn-press" onClick={()=>setShowCalc(true)} title="Calculator" style={{background:"none",border:"none",color:"rgba(247,243,236,0.45)",cursor:"pointer",padding:4,fontSize:15,lineHeight:1}}>🧮</button>
          <button className="btn-press" onClick={()=>setShowReport(true)} style={{background:"none",border:"none",color:"rgba(247,243,236,0.2)",cursor:"pointer",padding:4}}><Flag size={14}/></button>
          <div className={timerClass} style={{fontFamily:"'DM Mono',monospace",fontSize:16,fontWeight:700,color:timerColor,minWidth:52,textAlign:"right"}}>{fmt(timeLeft)}</div>
        </div>
      </div>

      {isWarning&&!isUrgent&&<div style={{background:"rgba(249,115,22,0.12)",borderBottom:"1px solid rgba(249,115,22,0.25)",padding:"8px 18px"}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#f97316",letterSpacing:"0.1em"}}>⏱ 5 MINUTES REMAINING</span></div>}
      {isUrgent&&<div style={{background:"rgba(192,57,43,0.15)",borderBottom:"1px solid rgba(192,57,43,0.3)",padding:"8px 18px"}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#C0392B",letterSpacing:"0.1em"}}>🔴 UNDER 1 MINUTE — SUBMIT NOW</span></div>}

      <div className="exam-prog-track"><div className="exam-prog-fill" style={{width:`${Math.round((answeredCount/totalQ)*100)}%`}}/></div>

      {showNav&&(
        <div style={{background:T.surface2,padding:"12px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",flexWrap:"wrap",gap:6}}>
          {questions.map((_,i)=>(
            <button key={i} className="btn-press" onClick={()=>{setCurrent(i);setShowNav(false);}} style={{width:32,height:32,borderRadius:6,border:"none",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,background:i===current?T.gold:answers[i]?T.success:T.surface,color:i===current?T.bg:answers[i]?T.bg:T.muted}}>{i+1}</button>
          ))}
          <button onClick={()=>setShowNav(false)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",alignSelf:"center",marginLeft:"auto"}}><X size={14}/></button>
        </div>
      )}

      <div className="question-enter" key={current} style={{flex:1,padding:"20px 18px",paddingBottom:130+navOffset}}>
        <div style={{maxWidth:960,margin:"0 auto",width:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          {q.topic&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,letterSpacing:"0.12em",flex:1,marginRight:8}}>{q.topic.toUpperCase()}</div>}
          <button className="btn-press" onClick={()=>setShowNav(!showNav)} style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,background:T.surface,border:`1px solid ${T.border}`,borderRadius:5,padding:"4px 8px",cursor:"pointer",whiteSpace:"nowrap"}}>{answeredCount}/{totalQ} answered</button>
        </div>
        <div style={{fontSize:15,color:T.text,lineHeight:1.65,marginBottom:22,fontWeight:500,fontFamily:"'Playfair Display','Noto Sans Math',serif"}}>{q.question}</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {Object.entries(q.options).sort(([a],[b])=>a.charCodeAt(0)-b.charCodeAt(0)).map(([k,v])=>{
            const selected=answers[current]===k;
            return (
              <button key={k} onClick={()=>handleAnswer(k)} className={`btn-press${lastAnswer===k&&selected?" answer-bounce":""}`} style={{width:"100%",padding:"14px 16px",border:`1px solid ${selected?T.gold:T.border}`,borderRadius:10,background:selected?"rgba(184,151,62,0.12)":T.surface,cursor:"pointer",textAlign:"left",display:"flex",gap:12,alignItems:"flex-start",transition:"border .15s,background .15s"}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:selected?T.gold:T.muted,fontWeight:700,minWidth:16,paddingTop:1}}>{k}.</span>
                <span style={{fontSize:14,color:T.text,lineHeight:1.5}}>{v}</span>
              </button>
            );
          })}
        </div>
        </div>
      </div>

      <div style={{position:"fixed",bottom:navOffset,left:0,right:0,background:T.navBg,borderTop:`1px solid ${T.navBorder}`,padding:"12px 18px",display:"flex",gap:10,zIndex:150}}>
        <div style={{maxWidth:960,margin:"0 auto",width:"100%",display:"flex",gap:10}}>
        <button className="btn-press" onClick={()=>setCurrent(c=>Math.max(0,c-1))} disabled={current===0} style={{flex:1,padding:"12px 0",border:`1px solid ${T.border}`,borderRadius:8,background:"transparent",color:current===0?`${T.muted}44`:T.muted,fontFamily:"'DM Mono',monospace",fontSize:10,cursor:current===0?"not-allowed":"pointer"}}>← PREV</button>
        {current<totalQ-1
          ?<button className="btn-press" onClick={()=>setCurrent(c=>Math.min(totalQ-1,c+1))} style={{flex:2,padding:"12px 0",border:"none",borderRadius:8,background:T.gold,color:T.bg,fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,cursor:"pointer"}}>NEXT →</button>
          :<button className="btn-press" onClick={handleSubmit} style={{flex:2,padding:"12px 0",border:"none",borderRadius:8,background:"linear-gradient(135deg,#004B3B,#8A6A1E)",color:"#F7F3EC",fontFamily:"'Playfair Display',serif",fontSize:14,fontWeight:700,cursor:"pointer"}}>
            {answeredCount<totalQ?`Submit (${totalQ-answeredCount} unanswered)`:"Submit Exam"}
          </button>
        }
        </div>
      </div>
    </div>
  );
}

// ─── DRILL SCREEN ─────────────────────────────────────────────────────────────
function DrillScreen({user,history,QB,onEnd,onBack,dark,setDark,T,showToast}) {
  const weakTopics=useMemo(()=>calcWeakTopics(history),[history]);
  const userSubjects=user.subjects||[];
  const [drillMode,setDrillMode]=useState("weak");
  const [selSub,setSelSub]=useState(userSubjects[0]||"");
  const [selCourse,setSelCourse]=useState(null);
  const [startedWith,setStartedWith]=useState(null);
  const [drillLabel,setDrillLabel]=useState("");
  const [selectedSubject,setSelectedSubject]=useState(userSubjects[0]||"");
  const [pendingDrill,setPendingDrill]=useState(null);
  const [confidence,setConfidence]=useState(null);
  const qbLoaded=Object.keys(QB).length>0;

  const subjectMeta=SUBJECT_META[selSub]||{color:"#B8973E",icon:"BKS"};
  const courses=JUPEB_COURSES[selSub]||[];

  // Enrich weak topics with their course codes (for display)
  const weakTopicsLabeled=useMemo(()=>
    weakTopics.map(t=>{
      // Try user's own subjects first before searching all
      for(const sub of (userSubjects||[])){
        const code=getQuestionCourse(sub,t);
        if(code)return{topic:t,code,subject:sub};
      }
      const{subject,code}=findTopicCourse(t);
      return{topic:t,code,subject};
    })
  ,[weakTopics,userSubjects]);

  if(startedWith){
    return <ExamScreen config={{questions:startedWith,subject:selectedSubject||userSubjects[0]||"Drill",year:"mixed",mode:"drill",timeLimit:15,startTime:Date.now()}} user={user} onEnd={r=>{track("drill_completed",{uid:user?.uid,pct:r.pct});onEnd({...r,mode:"Drill",confidence});setConfidence(null);}} onQuit={()=>{setStartedWith(null);setConfidence(null);}} onLimitHit={async partialResult=>{if(partialResult){await onEnd({...partialResult,mode:"Drill",confidence});setConfidence(null);}else{setStartedWith(null);setConfidence(null);}}} dark={dark} setDark={setDark} T={T} navOffset={65}/>;
  }

  const startDrill=async(questions,label,subjectName)=>{
    if(!qbLoaded){showToast&&showToast("Questions are still loading. Try again in a moment.","info");return;}
    if(!questions||questions.length===0){showToast&&showToast("No questions found for this selection. Try another.","info");return;}
    if(!user?.isPremium){
      try{
        const{allowed}=await checkDailyLimit(user.uid,false);
        if(!allowed){showToast&&showToast("Daily limit reached — upgrade to Premium to keep drilling.","info");onBack();return;}
      }catch{}
    }
    const shuffled=[...questions].sort(()=>Math.random()-0.5).slice(0,10);
    setDrillLabel(label);
    if(subjectName)setSelectedSubject(subjectName);
    setPendingDrill(shuffled);
  };

  // Confidence picker modal
  if(pendingDrill&&!confidence){
    return(
      <div style={{minHeight:"100dvh",background:"rgba(0,0,0,0.95)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
        <div style={{width:"100%",maxWidth:400,background:"#111",border:"1px solid rgba(184,151,62,0.2)",borderRadius:16,padding:28}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.6)",letterSpacing:"0.2em",marginBottom:12,textAlign:"center"}}>BEFORE YOU START</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:"#F7F3EC",marginBottom:6,textAlign:"center"}}>How confident are you in</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:"#B8973E",marginBottom:20,textAlign:"center"}}>{drillLabel}?</div>
          {["High","Medium","Low"].map(level=>(
            <button key={level} className="btn-press" onClick={()=>{setConfidence(level);setStartedWith(pendingDrill);setPendingDrill(null);}} style={{
              width:"100%",padding:"14px",border:"1px solid rgba(184,151,62,0.25)",borderRadius:10,
              background:level==="High"?"rgba(74,222,128,0.08)":level==="Medium"?"rgba(184,151,62,0.08)":"rgba(249,115,22,0.08)",
              color:level==="High"?"#4ade80":level==="Medium"?"#B8973E":"#f97316",
              fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700,cursor:"pointer",
              marginBottom:8,letterSpacing:"0.08em"}}>
              {level==="High"?"💪 HIGH — I know this well":level==="Medium"?"🤔 MEDIUM — I'm not sure":"😬 LOW — I might struggle"}
            </button>
          ))}
          <button onClick={()=>setPendingDrill(null)} style={{width:"100%",padding:"10px",border:"none",background:"transparent",color:"rgba(247,243,236,0.3)",fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer",marginTop:4}}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,paddingBottom:80}}>
      <div style={{background:T.navBg,padding:"20px 22px 16px",borderBottom:`1px solid ${T.navBorder}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button className="btn-press" onClick={onBack} style={{background:"none",border:"none",color:"rgba(247,243,236,0.5)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:10,padding:0,display:"flex",alignItems:"center",gap:4}}><ChevronLeft size={14}/> Back</button>
            <div style={{width:1,height:14,background:"rgba(255,255,255,0.1)"}}/>
            <Logo size={17} onDark={true}/>
          </div>
          <ThemeBtn dark={dark} setDark={setDark} T={T}/>
        </div>
        <div style={{marginTop:14}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:"#F7F3EC"}}>Drill Mode</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.35)",letterSpacing:"0.08em",marginTop:3}}>10 questions · 15 minutes · targeted practice</div>
        </div>
      </div>

      {/* QB loading warning */}
      {!qbLoaded&&(
        <div style={{background:"rgba(249,115,22,0.1)",borderBottom:"1px solid rgba(249,115,22,0.25)",padding:"10px 18px",display:"flex",alignItems:"center",gap:8}}>
          <div style={{display:"flex",gap:5}}>{[0,1,2].map(i=><div key={i} style={{width:4,height:4,borderRadius:"50%",background:"#f97316",animation:`blink 1.2s ${i*0.2}s ease-in-out infinite`}}/>)}</div>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#f97316",letterSpacing:"0.08em"}}>Loading question bank — drill will be ready shortly</span>
        </div>
      )}

      <div style={{padding:"18px",maxWidth:1000,margin:"0 auto",width:"100%"}}>
        {/* Mode toggle — 3 tabs */}
        <div className="fi1" style={{display:"flex",background:T.surface,borderRadius:8,padding:3,marginBottom:20,gap:3,border:`1px solid ${T.border}`}}>
          {[{key:"weak",label:"SCORE BLOCKERS"},{key:"course",label:"BY COURSE"},{key:"subject",label:"BY SUBJECT"}].map(m=>(
            <button key={m.key} className="btn-press" onClick={()=>setDrillMode(m.key)} style={{flex:1,padding:"9px 0",border:"none",borderRadius:6,background:drillMode===m.key?T.gold:"transparent",color:drillMode===m.key?T.bg:T.muted,fontFamily:"'DM Mono',monospace",fontSize:11,cursor:"pointer",letterSpacing:"0.03em",fontWeight:drillMode===m.key?700:400}}>
              {m.label}
            </button>
          ))}
        </div>

        {/* ── SCORE BLOCKERS — per subject ── */}
        {drillMode==="weak"&&(
          weakTopics.length===0?(
            <div className="fi2" style={{textAlign:"center",padding:"40px 20px"}}>
              <Target size={40} color={T.muted} style={{margin:"0 auto 16px",opacity:0.4}}/>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:700,color:T.text,marginBottom:8}}>No score blockers found yet.</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,lineHeight:1.8,marginBottom:20}}>
                Complete your first practice session.<br/>
                CrediQ will identify your gaps and<br/>drill them here automatically.
              </div>
              <button className="btn-press" onClick={onBack} style={{padding:"12px 24px",border:"none",borderRadius:8,background:"linear-gradient(135deg,#004B3B,#8A6A1E)",color:"#F7F3EC",fontFamily:"'Playfair Display',serif",fontSize:14,fontWeight:700,cursor:"pointer"}}>Start a Practice Session →</button>
            </div>
          ):(
            <>
              {/* Group score blockers by subject */}
              {userSubjects.map(sub=>{
                const subBlockers=weakTopicsLabeled.filter(w=>w.subject===sub);
                if(!subBlockers.length)return null;
                const meta=SUBJECT_META[sub]||{color:"#B8973E",icon:"BKS"};
                return (
                  <div key={sub} className="fi2" style={{background:T.surface,border:`1px solid ${T.border}`,borderLeft:`3px solid ${meta.color}`,borderRadius:9,padding:"13px 15px",marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <SubjectBadge code={meta.icon} color={meta.color} size={16}/>
                        <div>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:meta.color,fontWeight:700,letterSpacing:"0.1em"}}>{sub.toUpperCase()} SCORE BLOCKERS</div>
                        </div>
                      </div>
                      <button className="btn-press" onClick={()=>{
                        const qs=getQuestionsForDrill(QB,[sub],subBlockers.map(b=>b.topic),10);
                        startDrill(qs,`${meta.icon} Blockers`,sub);
                      }} style={{background:"none",border:`1px solid ${meta.color}44`,borderRadius:6,padding:"5px 10px",color:meta.color,fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,cursor:"pointer",flexShrink:0}}>
                        Fix These →
                      </button>
                    </div>
                    {subBlockers.slice(0,4).map(({topic,code},i)=>(
                      <div key={topic} style={{display:"flex",alignItems:"center",gap:8,marginBottom:i<subBlockers.length-1?6:0,padding:"7px 8px",background:`rgba(239,68,68,${i===0?0.06:0.03})`,borderRadius:6}}>
                        <span style={{fontSize:10}}>{i===0?"🔴":"🟡"}</span>
                        <span style={{fontSize:12,color:T.text,flex:1}}>{topic}</span>
                        {code&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.gold,background:`${T.gold}15`,borderRadius:4,padding:"2px 6px",flexShrink:0}}>{code}</span>}
                      </div>
                    ))}
                  </div>
                );
              })}
              <BtnPrimary onClick={()=>{
                const q=getQuestionsForDrill(QB,userSubjects,weakTopics,10);
                startDrill(q,"All Score Blockers",userSubjects[0]);
              }} T={T}>Fix All Score Blockers — 10 Questions →</BtnPrimary>
            </>
          )
        )}

        {/* ── BY COURSE (001-004) ── */}
        {drillMode==="course"&&(
          <>
            <div className="fi2" style={{marginBottom:16}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:10}}>SELECT SUBJECT</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {userSubjects.map(sub=>{
                  const meta=SUBJECT_META[sub]||{icon:"BKS",color:"#B8973E"};
                  const active=sub===selSub;
                  return (
                    <button key={sub} className="btn-press" onClick={()=>{setSelSub(sub);setSelCourse(null);}} style={{padding:"8px 14px",border:`1px solid ${active?meta.color:T.border}`,borderRadius:8,background:active?`${meta.color}15`:T.surface,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                      <SubjectBadge code={meta.icon} color={meta.color} size={16}/>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:active?meta.color:T.muted,fontWeight:active?700:400}}>{meta.icon}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selSub&&courses.length>0&&(
              <div className="fi3" style={{marginBottom:20}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:10}}>SELECT COURSE UNIT</div>
                {courses.map(c=>{
                  const qCount=qbLoaded?getQuestionsForCourse(QB,selSub,c.code).length:0;
                  const active=c.code===selCourse;
                  return (
                    <div key={c.code} className="btn-press" onClick={()=>setSelCourse(c.code)} style={{padding:"13px 15px",background:active?`${subjectMeta.color}15`:T.surface,border:`1px solid ${active?subjectMeta.color:T.border}`,borderRadius:9,cursor:"pointer",marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:active?subjectMeta.color:T.gold,fontWeight:700}}>{c.code}</span>
                            <span style={{fontSize:13,color:T.text,fontWeight:active?600:400}}>{c.name}</span>
                          </div>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,lineHeight:1.5}}>{c.desc}</div>
                        </div>
                        <div style={{textAlign:"right",marginLeft:10,flexShrink:0}}>
                          {qbLoaded?<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>{qCount}q</div>:<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>…</div>}
                          {active&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:subjectMeta.color,marginTop:2}}>✓</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {selCourse&&(
              <BtnPrimary onClick={()=>{
                const qs=getQuestionsForCourse(QB,selSub,selCourse);
                startDrill(qs,selCourse,selSub);
              }} T={T}>Drill {selCourse} — 10 Questions</BtnPrimary>
            )}
          </>
        )}

        {/* ── BY SUBJECT ── */}
        {drillMode==="subject"&&(
          <>
            <div className="fi2" style={{marginBottom:16}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:10}}>SELECT SUBJECT</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {userSubjects.map(sub=>{
                  const meta=SUBJECT_META[sub]||{icon:"BKS",color:"#B8973E"};
                  const active=sub===selSub;
                  return (
                    <button key={sub} className="btn-press" onClick={()=>setSelSub(sub)} style={{padding:"8px 14px",border:`1px solid ${active?meta.color:T.border}`,borderRadius:8,background:active?`${meta.color}15`:T.surface,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                      <SubjectBadge code={meta.icon} color={meta.color} size={16}/>
                      <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:active?meta.color:T.muted,fontWeight:active?700:400}}>{sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {selSub&&(
              <div className="fi3">
                <BtnPrimary onClick={()=>startDrill(getAllQuestionsForSubject(QB,selSub),`${SUBJECT_META[selSub]?.icon} Random`,selSub)} T={T}>
                  Drill {SUBJECT_META[selSub]?.icon} — 10 Random Questions
                </BtnPrimary>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── CANVAS HELPER ────────────────────────────────────────────────────────────
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}

// ─── RESULTS SCREEN ───────────────────────────────────────────────────────────
function ResultsScreen({result,user,history,onHome,onRetry,onDrill,dark,setDark,T}) {
  const {subject,year,correct,total,pct,wrongTopics,questionResults,mode,preReadiness=0,postReadiness=0,hitLimit=false,confidence=null}=result;
  const readinessDelta=postReadiness-preReadiness;
  const g=grade(pct),gc=gradeColor(g,T);
  const [showReview,setShowReview]=useState(false);
  const [showShareModal,setShowShareModal]=useState(false);
  const isCelebration=pct>=60;
  const EASE=[0.16,1,0.3,1];
  const baseCopy=CELEBRATE_COPY[user?.course]||CELEBRATE_COPY["Other"];
  const uniShortName=user?.targetUniversity||"";
  const copy={
    win:uniShortName&&isCelebration
      ?`That's ${uniShortName} ${user?.course?.split("/")[0]?.trim()||""} energy. Keep it up.`
      :baseCopy.win,
    push:baseCopy.push
  };
  const gradeClass=g==="A"?"grade-reveal-a":g==="B"?"grade-reveal-b":g==="F"?"grade-reveal-f":"grade-reveal";
  const sg=shareGrade(pct);
  const sortedWrongTopics=Object.entries(
    (questionResults||[])
      .filter(q=>!q.correct&&q.topic)
      .reduce((m,q)=>{m[q.topic]=(m[q.topic]||0)+1;return m;},{})
  ).sort((a,b)=>b[1]-a[1]);

  useEffect(()=>{
    const t=setTimeout(()=>setShowShareModal(true),2500);
    return()=>clearTimeout(t);
  },[]);

  return (
    <>
      {showShareModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.95)",zIndex:300,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"20px"}} onClick={()=>setShowShareModal(false)}>
          <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:380}}>
            <div style={{width:"100%",borderRadius:4,overflow:"hidden",boxShadow:"0 32px 80px rgba(0,0,0,0.8)"}}>
              <CrediQShareCard grade={sg} score={correct} total={total} subject={subject==="Mixed"?"Mixed":subject} year={year==="All Years"?"All":year} username={user?.name?.split(" ")[0]||"Student"}/>
            </div>
            <div style={{textAlign:"center",marginTop:16,marginBottom:12}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"rgba(247,243,236,0.7)",letterSpacing:"0.12em",marginBottom:4}}>SHARE YOUR RESULT</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.3)"}}>Share to WhatsApp, Telegram, Snapchat & more</div>
            </div>
            <button onClick={async()=>{
              const cfg=GRADE_CONFIG[sg]||GRADE_CONFIG["A"];
              const acc=Math.round((correct/total)*100);
              const canvas=document.createElement("canvas");
              canvas.width=600;canvas.height=600;
              const ctx=canvas.getContext("2d");
              // Background
              const bg=ctx.createLinearGradient(0,0,600,600);
              bg.addColorStop(0,cfg.bgBase);bg.addColorStop(0.4,cfg.bgMid);bg.addColorStop(1,cfg.bgBase);
              ctx.fillStyle=bg;ctx.fillRect(0,0,600,600);
              // Grid lines
              ctx.strokeStyle="rgba(184,151,62,0.06)";ctx.lineWidth=1;
              for(let i=0;i<600;i+=54){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,600);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(600,i);ctx.stroke();}
              // Logo
              ctx.font="bold 28px serif";ctx.fillStyle="#F7F3EC";ctx.fillText("Cred",42,70);
              ctx.fillStyle="#B8973E";ctx.fillText("iq",42+ctx.measureText("Cred").width,70);
              // Grade badge
              const badgeText=cfg.label;ctx.font="bold 11px monospace";const bw=ctx.measureText(badgeText).width;
              ctx.strokeStyle=cfg.gradeColor;ctx.lineWidth=1;
              roundRect(ctx,600-42-bw-20,48,bw+20,24,12);ctx.stroke();
              ctx.fillStyle=cfg.gradeColor;ctx.fillText(badgeText,600-42-bw-10,64);
              // Big grade letter (ghost)
              ctx.font="bold 340px serif";ctx.fillStyle=cfg.gradeColor;ctx.globalAlpha=0.04;ctx.fillText(sg,-20,340);ctx.globalAlpha=1;
              // Big grade letter
              ctx.font="bold 260px serif";ctx.fillStyle=cfg.gradeColor;
              ctx.shadowColor=cfg.gradeColor;ctx.shadowBlur=60;ctx.fillText(sg,42,330);ctx.shadowBlur=0;
              // Line
              ctx.fillStyle=`rgba(${cfg.glowRgb},0.5)`;ctx.fillRect(42,345,80,2);
              // Score text
              ctx.font="bold 40px serif";ctx.fillStyle="rgba(247,243,236,0.95)";ctx.fillText(`${correct}/${total} correct`,42,402);
              // Accuracy
              ctx.font="bold 28px monospace";ctx.fillStyle=cfg.gradeColor;ctx.fillText(`${acc}% accuracy`,42,442);
              // Tagline — WhatsApp hook
              ctx.font="italic 18px serif";ctx.fillStyle="rgba(247,243,236,0.35)";ctx.fillText("I just ran a JUPEB simulation 👀",42,476);
              // Footer
              ctx.font="13px monospace";ctx.fillStyle="rgba(247,243,236,0.5)";
              const footerLeft=`${subject==="Mixed"?"Mixed":subject} · ${year==="All Years"?"All":year}`;
              ctx.fillText(footerLeft,42,558);
              ctx.font="italic 14px serif";ctx.fillStyle="rgba(247,243,236,0.4)";
              ctx.fillText(user?.name?.split(" ")[0]||"Student",600-42-ctx.measureText(user?.name?.split(" ")[0]||"Student").width,558);
              // Readiness delta
              const dLeft=daysUntil("2026-08-03");
              if(postReadiness>0){
                ctx.font="bold 13px monospace";
                if(readinessDelta>0){
                  ctx.fillStyle="rgba(34,197,94,0.85)";
                  ctx.fillText(`${preReadiness}% → ${postReadiness}% score  ↑${readinessDelta}%`,42,506);
                }else{
                  ctx.fillStyle="rgba(34,197,94,0.85)";
                  ctx.fillText(`${postReadiness}% exam ready`,42,506);
                }
              }
              ctx.font="10px monospace";
              ctx.fillStyle="rgba(192,57,43,0.55)";
              ctx.fillText(`${dLeft}d to August 3 · credi-q.vercel.app`,42,524);

              // QR code via API — resolves even if offline
              await new Promise(resolve=>{
                const qrImg=new Image();
                qrImg.crossOrigin="anonymous";
                qrImg.onload=()=>{
                  // White background for QR
                  ctx.fillStyle="#F7F3EC";
                  roundRect(ctx,600-42-84,468,84,84,6);ctx.fill();
                  ctx.drawImage(qrImg,600-42-80,472,76,76);
                  resolve();
                };
                qrImg.onerror=()=>resolve();
                qrImg.src="https://api.qrserver.com/v1/create-qr-code/?size=80x80&color=0A1410&bgcolor=F7F3EC&data=https://credi-q.vercel.app";
              });

              try{canvas.toBlob(async blob=>{
                if(!blob)return;
                const file=new File([blob],"crediq-result.png",{type:"image/png"});
                if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){
                  try{
                    await navigator.share({files:[file],title:`I scored ${sg} on CrediQ!`,text:`I just ran a JUPEB simulation on CrediQ 📊\n\nGrade: ${sg} · ${acc}% accuracy\n${subject==="Mixed"?"Mixed Practice":subject}\n\nIf you're preparing for JUPEB, try this 👇\ncredi-q.vercel.app`});
                    return;
                  }catch(e){if(e.name==="AbortError")return;}
                }
                // Fallback: open share with just text
                if(navigator.share){
                  try{await navigator.share({title:`CrediQ Result — Grade ${sg}`,text:`I just ran a JUPEB simulation on CrediQ 📊\n\nGrade: ${sg} · ${acc}% accuracy\n${subject==="Mixed"?"Mixed Practice":subject}\n\nIf you're preparing for JUPEB, try this 👇\ncredi-q.vercel.app`});return;}catch{}
                }
                // Final fallback: download image
                const url=URL.createObjectURL(blob);
                const a=document.createElement("a");a.href=url;a.download="crediq-result.png";a.click();
                setTimeout(()=>URL.revokeObjectURL(url),5000);
              },"image/png");}catch(secErr){
                // Canvas tainted by CORS (QR image) — fall back to text-only share
                if(navigator.share){try{await navigator.share({title:`CrediQ Result — Grade ${sg}`,text:`I scored ${sg} on ${subject==="Mixed"?"Mixed":subject} JUPEB Exam Readiness!\n${correct}/${total} · ${acc}% accuracy\n\nCheck your readiness: credi-q.vercel.app`});}catch{}}
              }
            }} style={{width:"100%",padding:"14px 0",border:"none",borderRadius:10,background:"linear-gradient(135deg,#004B3B,#8A6A1E)",color:"#F7F3EC",fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:8,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              <MessageCircle size={16}/> Share to WhatsApp / Telegram / More
            </button>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(247,243,236,0.25)",textAlign:"center",marginBottom:10}}>Long press image to save · Screenshot also works</div>
            <button onClick={()=>setShowShareModal(false)} style={{width:"100%",padding:"12px 0",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,background:"transparent",color:"rgba(247,243,236,0.4)",fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer",letterSpacing:"0.08em"}}>CLOSE</button>
          </div>
        </div>
      )}

      <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,padding:"18px",paddingBottom:40}}>
        <div style={{maxWidth:860,margin:"0 auto",width:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <Logo size={18} onDark={dark}/><ThemeBtn dark={dark} setDark={setDark} T={T}/>
        </div>
        <div className="fi1" style={{textAlign:"center",marginBottom:6}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,letterSpacing:"0.22em"}}>— SESSION COMPLETE —</div>
        </div>
        {/* Coach voice: lead with diagnosis on bad sessions, not just the grade */}
        {!isCelebration&&(
          <motion.div className="fi1" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{duration:0.4,ease:EASE}}
            style={{background:"rgba(184,151,62,0.05)",border:"1px solid rgba(184,151,62,0.18)",borderRadius:12,padding:"14px 16px",marginBottom:14,textAlign:"center"}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.gold,marginBottom:4}}>
              {pct<40?"Rough one. But we found exactly where the gap is.":pct<60?"Close. The gap is clear — let's close it.":"Almost there. Fix one more topic."}
            </div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}80`}}>
              {sortedWrongTopics[0]?`${sortedWrongTopics[0][0]} is your biggest cost today.`:"Review the questions below to find your gap."}
            </div>
          </motion.div>
        )}
        {/* Fix 6: clearly label mixed sessions so they're never confused with real JUPEB performance */}
        {subject==="Mixed"&&(
          <div className="fi1" style={{background:"rgba(184,151,62,0.07)",border:"1px solid rgba(184,151,62,0.2)",borderRadius:9,padding:"10px 14px",marginBottom:12,textAlign:"center"}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.gold,letterSpacing:"0.14em",marginBottom:3}}>PRACTICE MODE ONLY</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>Mixed practice doesn't affect your JUPEB grade estimates or subject intelligence.</div>
          </div>
        )}
        {hitLimit&&(
          <div className="fi1" style={{background:"rgba(249,115,22,0.1)",border:"1px solid rgba(249,115,22,0.3)",borderRadius:9,padding:"12px 15px",marginBottom:12,textAlign:"center"}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"#f97316",letterSpacing:"0.1em",marginBottom:4}}>DAILY LIMIT REACHED — 30 QUESTIONS</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>Upgrade to Premium for unlimited sessions</div>
          </div>
        )}
        <div className="fi2" style={{textAlign:"center",marginBottom:8}}>
          {pct>=75&&(
            <motion.div initial={{scale:0,opacity:0}} animate={{scale:1,opacity:1}} transition={{type:"spring",stiffness:400,damping:18,delay:0.3}}
              style={{marginBottom:10}}>
              <div style={{fontSize:pct>=90?36:28,marginBottom:4}}>{pct>=90?"🔥🔥🔥":pct>=80?"🔥🔥":"🔥"}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#4ade80",letterSpacing:"0.14em"}}>
                {pct>=90?"EXAM-READY TERRITORY":pct>=80?"STRONG PERFORMANCE":"GOOD SESSION"}
              </div>
            </motion.div>
          )}
          <div className={gradeClass} style={{fontFamily:"'Playfair Display',serif",fontSize:g==="A"?140:120,fontWeight:900,color:gc,lineHeight:0.85}}>{g}</div>
        </div>
        <div className="fi3" style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,color:gc,marginBottom:6}}>{correct}/{total} correct · {pct}%</div>
          {postReadiness>0&&(
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(34,197,94,0.85)",marginBottom:6}}>
              {readinessDelta>0
                ?`Score: ${preReadiness}% → ${postReadiness}%  ↑${readinessDelta}%`
                :`Score estimate: ${postReadiness}%`}
            </div>
          )}
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,color:T.text,fontStyle:"italic"}}>{isCelebration?copy.win:copy.push}</div>
        </div>

        {/* ── PHASE 3: CONFIDENCE vs PERFORMANCE ── */}
        {confidence&&mode==="Drill"&&(()=>{
          const expected=confidence==="High"?75:confidence==="Medium"?50:30;
          const over=pct<expected-15;
          const under=pct>expected+15;
          const spot=!over&&!under;
          return(
            <div className="fi3" style={{background:spot?"rgba(74,222,128,0.06)":over?"rgba(249,115,22,0.06)":"rgba(96,165,250,0.06)",border:`1.5px solid ${spot?"rgba(74,222,128,0.2)":over?"rgba(249,115,22,0.2)":"rgba(96,165,250,0.2)"}`,borderRadius:12,padding:"16px",marginBottom:12}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:10}}>🧠 CONFIDENCE VS PERFORMANCE</div>
              <div style={{display:"flex",justifyContent:"space-around",marginBottom:12}}>
                <div style={{textAlign:"center"}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginBottom:4}}>BEFORE</div>
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:confidence==="High"?"#4ade80":confidence==="Medium"?"#B8973E":"#f97316"}}>{confidence}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted}}>confidence</div>
                </div>
                <div style={{display:"flex",alignItems:"center",color:T.muted,fontSize:18}}>→</div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginBottom:4}}>ACTUAL</div>
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:gradeColor(grade(pct),T)}}>{pct}%</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted}}>score</div>
                </div>
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:spot?"#4ade80":over?"#f97316":"#60a5fa",textAlign:"center",fontWeight:700,letterSpacing:"0.06em"}}>
                {spot?"✓ ACCURATE SELF-ASSESSMENT":over?"⚠ OVERESTIMATED — keep practising this topic":"↑ UNDERESTIMATED — you know more than you think!"}
              </div>
            </div>
          );
        })()}

        {sortedWrongTopics.length>0&&!isCelebration&&(
          <div className="fi4" style={{background:`${T.danger}08`,border:`1px solid ${T.danger}25`,borderRadius:9,padding:"13px 15px",marginBottom:12}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.danger,letterSpacing:"0.12em",marginBottom:10}}>SCORE BLOCKERS — these cost you marks today</div>
            {sortedWrongTopics.slice(0,4).map(([t,c])=>(
              <div key={t} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7,padding:"8px 10px",background:T.surface,borderRadius:6}}>
                <div><div style={{fontSize:13,color:T.text,fontWeight:500}}>{t}</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{c} question{c!==1?"s":""} missed</div></div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.danger,background:`${T.danger}15`,borderRadius:4,padding:"3px 7px"}}>FIX THIS</div>
              </div>
            ))}
          </div>
        )}

        {/* Share button */}
        <div className="fi4" style={{marginBottom:12}}>
          <button className="btn-press" onClick={()=>setShowShareModal(true)} style={{width:"100%",padding:"14px",border:"1px solid rgba(184,151,62,0.3)",borderRadius:10,background:"rgba(184,151,62,0.08)",color:"#B8973E",fontFamily:"'DM Mono',monospace",fontSize:10,letterSpacing:"0.12em",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <MessageCircle size={14}/> SHARE YOUR RESULT
          </button>
        </div>

        {wrongTopics?.length>0&&(
          <div className="fi4" style={{background:"rgba(184,151,62,0.06)",border:"1.5px solid rgba(184,151,62,0.25)",borderRadius:12,padding:"16px 16px",marginBottom:12}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.6)",letterSpacing:"0.16em",marginBottom:8}}>⚡ NEXT BEST ACTION</div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,color:T.text,marginBottom:4}}>
              <span style={{color:T.warn,fontWeight:700}}>{wrongTopics[0]}</span> is your biggest score blocker right now.
              {wrongTopics[1]&&<> <span style={{color:"rgba(247,243,236,0.4)"}}>Also: </span><span style={{color:T.gold,fontWeight:600}}>{wrongTopics[1]}</span>.</>}
            </div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginBottom:12,lineHeight:1.6}}>
              Fixing this one topic is the fastest path to your next grade letter.
            </div>
            <button className="btn-press" onClick={()=>onDrill&&onDrill()} style={{width:"100%",padding:"13px 0",border:"none",borderRadius:9,background:"linear-gradient(135deg,rgba(249,115,22,0.85),rgba(192,57,43,0.85))",color:"#F7F3EC",fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,cursor:"pointer",letterSpacing:"0.08em",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              <Target size={14}/> FIX {wrongTopics[0].toUpperCase().slice(0,22)} NOW →
            </button>
          </div>
        )}

        <div className="fi5" style={{display:"flex",flexDirection:"column",gap:8}}>
          <BtnPrimary onClick={onRetry} T={T}>{isCelebration?"Practice Again":"Retake. Fix the score."}</BtnPrimary>
          <button className="btn-press" onClick={()=>setShowReview(!showReview)} style={{width:"100%",padding:"11px 0",border:`1px solid ${showReview?T.gold:T.border}`,borderRadius:8,background:showReview?`${T.gold}10`:"transparent",color:showReview?T.gold:T.muted,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer"}}>
            {showReview?"HIDE REVIEW ▲":"REVIEW YOUR ANSWERS ▼ — where the real learning is"}
          </button>
          <button className="btn-press" onClick={()=>{track("share_result",{uid:user?.uid,grade:g,pct});setShowShareModal(true);}} style={{width:"100%",padding:"10px 0",border:`1px solid ${T.border}`,borderRadius:8,background:"transparent",color:T.gold,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer"}}>
            SAVE RESULT CARD — SCREENSHOT &amp; SHARE
          </button>
          <button className="btn-press" onClick={onHome} style={{width:"100%",padding:"10px 0",border:`1px solid ${T.border}`,borderRadius:8,background:"transparent",color:T.muted,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer"}}>HOME</button>

          {/* WhatsApp community nudge */}
          <div style={{marginTop:4,background:`${T.surface}`,border:`1px solid rgba(37,211,102,0.25)`,borderRadius:10,padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
            <div style={{fontSize:20,flexShrink:0}}>💬</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,color:T.text}}>Want daily JUPEB missions?</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginTop:2}}>Join the CrediQ student community 🔥</div>
            </div>
            <a href={WA_COMMUNITY} target="_blank" rel="noopener noreferrer"
              style={{flexShrink:0,padding:"8px 14px",background:"#25D366",border:"none",borderRadius:7,color:"#fff",fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,cursor:"pointer",textDecoration:"none",letterSpacing:"0.06em"}}>
              JOIN
            </a>
          </div>
        </div>

        {showReview&&(
          <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:12}}>
            {(questionResults||[]).map((r,i)=>(
              <div key={i} style={{background:T.surface,border:`1px solid ${r.correct?T.success+"33":T.danger+"33"}`,borderRadius:10,padding:"14px 16px",borderLeft:`3px solid ${r.correct?T.success:T.danger}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>Q{i+1}{r.topic?` · ${r.topic}`:""}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:r.correct?T.success:"#f97316"}}>{r.correct?"✓ CORRECT":"Almost — see explanation below"}</span>
                </div>
                <div style={{fontSize:13,color:T.text,lineHeight:1.6,marginBottom:10}}>{r.question}</div>
                {!r.correct&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.danger,marginBottom:6}}>You: <strong>{r.userAnswer||"—"}</strong> · Correct: <strong>{r.correctAnswer}</strong></div>}
                {r.explanation&&(
                  <div style={{background:`${T.gold}09`,border:`1px solid ${T.border}`,borderRadius:7,padding:"10px 12px"}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.gold,letterSpacing:"0.1em",marginBottom:5}}>EXPLANATION</div>
                    <div style={{fontSize:12,color:T.muted,lineHeight:1.6}}>{r.explanation}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        </div>{/* max-width wrapper */}
      </div>
    </>
  );
}

// ─── ANALYTICS SCREEN (redesigned) ───────────────────────────────────────────
function AnalyticsScreen({user,history,dark,setDark,T,onUpgrade,onNav}) {
  const isPremium=user?.isPremium;
  // Filter out "Mixed" and "Drill" sessions — only real subject sessions
  const cleanHistory=useMemo(()=>history.filter(h=>h.subject&&h.subject!=="Mixed"&&h.subject!=="Drill"&&h.subject!=="Random Warm-Up"&&h.subject!=="All Subjects Practice"),[history]);
  const readiness=useMemo(()=>calcReadiness(cleanHistory),[cleanHistory]);
  const subjectStats=useMemo(()=>calcSubjectStats(cleanHistory),[cleanHistory]);
  const recent10=cleanHistory.slice(-10);
  const studyMins=useMemo(()=>calcStudyTime(cleanHistory),[cleanHistory]);
  const streak=Streak.get();
  const [expandedSubject,setExpandedSubject]=useState(null);
  const [showCalculator,setShowCalculator]=useState(false);
  const userSubjects=user?.subjects||[];
  const onDrillTopic=(sub,topic)=>{onNav&&onNav("drill");};

  // Per-subject weak topics (not mixed)
  const subjectWeakMap=useMemo(()=>{
    const map={};
    userSubjects.forEach(sub=>{
      const subH=cleanHistory.filter(h=>h.subject===sub);
      if(!subH.length){map[sub]=[];return;}
      const topicCount={};
      subH.forEach(h=>(h.wrongTopics||[]).forEach(t=>{topicCount[t]=(topicCount[t]||0)+1;}));
      // Also check recent sessions (last 5) for recency weight
      const recent=subH.slice(-5);
      const recentCount={};
      recent.forEach(h=>(h.wrongTopics||[]).forEach(t=>{recentCount[t]=(recentCount[t]||0)+1;}));
      const sorted=Object.entries(topicCount)
        .map(([topic,count])=>({topic,count,recent:recentCount[topic]||0,score:count+(recentCount[topic]||0)*2}))
        .sort((a,b)=>b.score-a.score)
        .slice(0,5);
      map[sub]=sorted;
    });
    return map;
  },[cleanHistory,userSubjects]);

  // Find strongest + weakest from clean data
  const strongest=Object.entries(subjectStats).filter(([k])=>k!=="Mixed"&&k!=="Drill").sort((a,b)=>{
    const aAvg=a[1].totalPct/a[1].sessions,bAvg=b[1].totalPct/b[1].sessions;
    return bAvg-aAvg;
  })[0];
  const weakest=Object.entries(subjectStats).filter(([k])=>k!=="Mixed"&&k!=="Drill").sort((a,b)=>{
    const aAvg=a[1].totalPct/a[1].sessions,bAvg=b[1].totalPct/b[1].sessions;
    return aAvg-bAvg;
  })[0];

  return (
    <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,paddingBottom:80}}>
      <div style={{background:T.navBg,padding:"20px 20px 16px",borderBottom:`1px solid ${T.navBorder}`}}>
        <div style={{maxWidth:1000,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><Logo size={18} onDark={true}/><div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.5)",letterSpacing:"0.15em",marginTop:4}}>JUPEB REPORT</div></div>
          <ThemeBtn dark={dark} setDark={setDark} T={T}/>
        </div>
      </div>
      <div style={{padding:"18px",maxWidth:1000,margin:"0 auto",width:"100%"}}>
        {cleanHistory.length===0?(
          <div style={{textAlign:"center",padding:"52px 24px"}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.gold}50`,letterSpacing:"0.2em",marginBottom:16}}>YOUR JUPEB REPORT</div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:T.text,marginBottom:10}}>No score report yet.</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,lineHeight:1.9,marginBottom:24}}>
              Complete your first practice session<br/>and we'll build your full JUPEB profile.
            </div>
            <button className="btn-press" onClick={()=>onNav&&onNav("setup")} style={{padding:"14px 32px",border:"none",borderRadius:11,background:"linear-gradient(135deg,#004B3B 0%,#1B3A2A 50%,#8A6A1E 100%)",color:"#F7F3EC",fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,cursor:"pointer"}}>
              Start Practice →
            </button>
          </div>
        ):(
          <>
            {/* Premium gate - show lock screen OR real content */}
            {!isPremium&&history.length>0?(
              <div style={{position:"relative",borderRadius:12,overflow:"hidden",marginBottom:16}}>
                {/* Blurred fake content behind */}
                <div style={{filter:"blur(6px)",pointerEvents:"none",userSelect:"none"}}>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
                    {["5","485m","3d"].map((v,i)=>(
                      <div key={i} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"12px 10px",textAlign:"center"}}>
                        <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:900,color:T.gold}}>{v}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>████</div>
                      </div>
                    ))}
                  </div>
                  <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"20px",marginBottom:10}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginBottom:8}}>YOUR SCORE ESTIMATE</div>
                    <div style={{fontFamily:"'Playfair Display',serif",fontSize:48,color:T.gold,fontWeight:900}}>██%</div>
                    <div style={{height:6,background:`${T.muted}22`,borderRadius:3,marginTop:8}}><div style={{width:"45%",height:"100%",background:T.gold,borderRadius:3}}/></div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginTop:8}}>████████████████</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                    {["STRONGEST SUBJECT","WEAKEST SUBJECT"].map(l=>(
                      <div key={l} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px",height:100}}>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,marginBottom:8}}>{l}</div>
                        <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,color:T.gold}}>███</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,color:T.success}}>██%</div>
                      </div>
                    ))}
                  </div>
                  <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px",marginBottom:10,height:120}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,marginBottom:8}}>ACCURACY TREND</div>
                    <div style={{display:"flex",gap:6,alignItems:"flex-end",height:60}}>
                      {[40,55,48,62,70].map((h,i)=><div key={i} style={{flex:1,height:`${h}%`,background:T.gold,borderRadius:2,opacity:0.5}}/>)}
                    </div>
                  </div>
                </div>
                {/* Lock overlay */}
                <div style={{position:"absolute",top:0,left:0,right:0,bottom:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(10,20,15,0.85)",padding:24,textAlign:"center"}}>
                  <div style={{fontSize:40,marginBottom:12}}>🔒</div>
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:700,color:"#F7F3EC",marginBottom:8}}>Unlock Full Analytics</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"rgba(247,243,236,0.5)",marginBottom:20,lineHeight:1.8}}>Readiness trend · Subject mastery · Weak areas · Accuracy over time</div>
                  <button onClick={onUpgrade} style={{background:"linear-gradient(135deg,#004B3B,#8A6A1E)",border:"none",borderRadius:8,padding:"14px 28px",color:"#F7F3EC",fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer",letterSpacing:"0.1em",width:"100%"}}>UNLOCK FOR ₦2,500 →</button>
                </div>
              </div>
            ):(
            <>
            {/* Stats summary row */}
            <div className="fi1" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
              {[
                {label:"SESSIONS",value:cleanHistory.length,color:T.gold},
                {label:"STUDY TIME",value:`${studyMins}m`,color:T.success},
                {label:"STREAK",value:`${streak.count}d`,color:T.warn},
              ].map(s=>(
                <div key={s.label} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"12px 10px",textAlign:"center"}}>
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:900,color:s.color,lineHeight:1,marginBottom:4}}>{s.value}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,letterSpacing:"0.1em"}}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Readiness */}
            <div className="fi1" style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px 18px",marginBottom:14}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,letterSpacing:"0.12em",marginBottom:6}}>YOUR SCORE ESTIMATE</div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:42,fontWeight:900,color:readiness>=70?T.success:readiness>=50?T.gold:T.warn,lineHeight:1,marginBottom:10}}>{readiness}%</div>
              <div style={{height:5,background:`${T.muted}33`,borderRadius:3}}>
                <div style={{height:"100%",width:`${readiness}%`,background:`linear-gradient(90deg,${T.gold},${T.gold2})`,borderRadius:3}}/>
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginTop:8}}>
                {readiness>=70?"You're exam ready. Don't let up.":readiness>=50?`${70-readiness}% more to hit exam-ready territory.`:"Keep going. Every session moves the number."}
              </div>
            </div>

            {/* Strongest + weakest */}
            {(strongest||weakest)&&(
              <div className="fi2" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                {strongest&&(()=>{const avg=Math.round(strongest[1].totalPct/strongest[1].sessions);const meta=SUBJECT_META[strongest[0]]||{icon:"BKS",color:"#B8973E"};return(
                  <div style={{background:`${T.success}10`,border:`1px solid ${T.success}30`,borderRadius:9,padding:"12px 14px"}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.success,letterSpacing:"0.1em",marginBottom:6}}>⭐ STRONGEST</div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}><SubjectBadge code={meta.icon} color={meta.color} size={16}/><span style={{fontSize:12,color:T.text,fontWeight:600}}>{strongest[0]}</span></div>
                    <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:900,color:T.success}}>{avg}%</div>
                  </div>
                );})()}
                {weakest&&weakest[0]!==strongest?.[0]&&(()=>{const avg=Math.round(weakest[1].totalPct/weakest[1].sessions);const meta=SUBJECT_META[weakest[0]]||{icon:"BKS",color:"#B8973E"};return(
                  <div style={{background:`${T.danger}08`,border:`1px solid ${T.danger}25`,borderRadius:9,padding:"12px 14px"}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.danger,letterSpacing:"0.1em",marginBottom:6}}>⚠ NEEDS WORK</div>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}><SubjectBadge code={meta.icon} color={meta.color} size={16}/><span style={{fontSize:12,color:T.text,fontWeight:600}}>{weakest[0]}</span></div>
                    <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:900,color:T.danger}}>{avg}%</div>
                  </div>
                );})()}
              </div>
            )}

            {/* ── PER-SUBJECT BREAKDOWN — the heart of Score Report ── */}
            <div className="fi2" style={{marginBottom:14}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:12}}>YOUR SUBJECTS — JUPEB GRADE ESTIMATE</div>
              {userSubjects.map(sub=>{
                const stat=subjectStats[sub];
                const avg=stat&&stat.sessions>0?Math.round(stat.totalPct/stat.sessions):null;
                const jg=avg!=null?jupebGrade(avg):null;
                const meta=SUBJECT_META[sub]||{color:T.gold,icon:"BKS"};
                const mastery=calcMastery(cleanHistory,sub);
                const topicMap=calcSubjectTopicMap(cleanHistory,sub);
                const limiter=findGradeLimiter(cleanHistory,sub);
                const expanded=expandedSubject===sub;
                const nextGradeMap={A:null,B:"A",C:"B",D:"C",E:"D",F:"E"};
                const nextGrade=jg?nextGradeMap[jg.grade]:null;
                const subBlockers=subjectWeakMap[sub]||[];

                if(!stat){
                  // No data for this subject yet — show motivating empty state
                  return (
                    <div key={sub} style={{background:T.surface,border:`1px solid ${T.border}`,borderLeft:`3px solid ${meta.color}44`,borderRadius:9,padding:"14px 16px",marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                        <SubjectBadge code={meta.icon} color={meta.color} size={18}/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,fontWeight:600,color:T.text}}>{sub}</div>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginTop:2}}>No sessions yet</div>
                        </div>
                        <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:900,color:`${T.muted}44`}}>—</div>
                      </div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,lineHeight:1.7}}>
                        Start practising {sub} to see your grade estimate here.
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={sub} style={{background:T.surface,border:`1px solid ${subBlockers.length>0?`${T.danger}30`:T.border}`,borderRadius:9,marginBottom:10,borderLeft:`3px solid ${jg?jg.color:meta.color}`,overflow:"hidden"}}>

                    {/* Subject header — tap to expand topic map */}
                    <div className="btn-press" onClick={()=>setExpandedSubject(expanded?null:sub)} style={{padding:"14px 16px",cursor:"pointer"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <SubjectBadge code={meta.icon} color={meta.color} size={20}/>
                          <div>
                            <div style={{fontSize:14,fontWeight:600,color:T.text}}>{sub}</div>
                            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginTop:1}}>{stat.sessions} session{stat.sessions!==1?"s":""} · best: {stat.best}%</div>
                          </div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          {mastery>0&&<MasteryRing pct={mastery} color={jg?jg.color:meta.color} size={36}/>}
                          <div style={{textAlign:"right"}}>
                            <div style={{display:"flex",alignItems:"baseline",gap:4,justifyContent:"flex-end"}}>
                              <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:jg?jg.color:`${T.muted}66`,lineHeight:1}}>{jg?jg.grade:"—"}</div>
                              {nextGrade&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}66`}}>→{nextGrade}</div>}
                            </div>
                            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>{avg}% · {jg?jg.points:0}pt{jg?.points!==1?"s":""}</div>
                          </div>
                        </div>
                      </div>

                      {/* Accuracy bar */}
                      <div style={{height:5,background:`${T.muted}22`,borderRadius:3,marginBottom:8}}>
                        <div style={{height:"100%",width:`${avg||0}%`,background:jg?jg.color:meta.color,borderRadius:3,transition:"width 0.8s ease"}}/>
                      </div>

                      {/* Grade limiter explanation */}
                      {limiter&&(
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:limiter.status==="blocker"?"#f97316":"#fb923c",lineHeight:1.6,marginBottom:4}}>
                          "{limiter.topic}" is holding your {sub} grade back{nextGrade?` — improve it to reach ${nextGrade}`:""}
                        </div>
                      )}

                      {/* Subject score blockers — per subject, not mixed */}
                      {subBlockers.length>0&&(
                        <div style={{marginTop:8,borderTop:`1px solid ${T.border}`,paddingTop:8}}>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"rgba(239,68,68,0.55)",letterSpacing:"0.12em",marginBottom:6}}>🔴 {sub.toUpperCase()} SCORE BLOCKERS</div>
                          {subBlockers.slice(0,3).map((b,i)=>(
                            <div key={b.topic} className="btn-press" onClick={e=>{e.stopPropagation();onNav&&onNav("drill");}}
                              style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:6,background:`rgba(239,68,68,${i===0?0.06:0.03})`,marginBottom:4,cursor:"pointer"}}>
                              <span style={{fontSize:10}}>{i===0?"🔴":"🟡"}</span>
                              <span style={{fontSize:12,color:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.topic}</span>
                              <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:i===0?"#ef4444":"#f59e0b",flexShrink:0}}>×{b.count} wrong</span>
                              <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.gold,flexShrink:0}}>Fix →</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {topicMap.length>0&&(
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.gold}88`,marginTop:8,textAlign:"center"}}>
                          {expanded?"▲ Hide topic map":`▼ Topic map · ${topicMap.length} topics tracked`}
                        </div>
                      )}
                    </div>

                    {/* Expanded topic map */}
                    {expanded&&topicMap.length>0&&(
                      <div style={{padding:"4px 14px 14px",borderTop:`1px solid ${T.border}`}}>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,letterSpacing:"0.12em",margin:"10px 0 8px"}}>TOPIC MAP — {sub}</div>
                        {topicMap.map(t=>(
                          <div key={t.topic} className="btn-press" onClick={()=>onNav&&onNav("drill")}
                            style={{display:"flex",alignItems:"center",gap:10,padding:"8px 8px",borderRadius:6,cursor:"pointer",marginBottom:4,background:`${t.color}08`}}>
                            <span style={{fontSize:11}}>{t.status==="strong"?"🟢":t.status==="needs-work"?"🟡":"🔴"}</span>
                            <span style={{fontSize:12,color:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.topic}</span>
                            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:t.color,flexShrink:0,fontWeight:700}}>{t.accuracy}%</span>
                            <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,flexShrink:0}}>{t.label}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {expanded&&topicMap.length===0&&(
                      <div style={{padding:"12px 16px",borderTop:`1px solid ${T.border}`,fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,lineHeight:1.7}}>
                        Topic-level data builds after a few more sessions.<br/>Keep practising {sub}.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Trend chart */}
            {recent10.length>1&&(
              <div className="fi3" style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"14px 16px",marginBottom:14}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:12}}>ACCURACY TREND (LAST {recent10.length} SESSIONS)</div>
                <TrendChart data={recent10} T={T}/>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:8}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Earliest</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>Latest</span>
                </div>
              </div>
            )}

            {/* Points Calculator */}
            <div className="fi3 btn-press" onClick={()=>setShowCalculator(true)} style={{background:"rgba(184,151,62,0.06)",border:`1px solid ${T.gold}33`,borderRadius:9,padding:"13px 15px",marginBottom:14,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontFamily:"'Playfair Display',serif",fontSize:14,fontWeight:700,color:T.text}}>Points Calculator</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginTop:2}}>See your total JUPEB points & university gap</div>
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:14,color:T.gold}}>→</div>
            </div>
          </>
            )}
          </>
        )}
      </div>
      {showCalculator&&<PointsCalculatorModal user={user} subjectStats={subjectStats} history={history} T={T} onClose={()=>setShowCalculator(false)}/>}
    </div>
  );
}

// ─── POINTS CALCULATOR MODAL ──────────────────────────────────────────────────
function PointsCalculatorModal({user,subjectStats,history,T,onClose}) {
  const userSubjects=user?.subjects||[];
  const [grades,setGrades]=useState(()=>{
    const g={};
    userSubjects.forEach(sub=>{
      const stat=subjectStats[sub];
      const avg=stat?Math.round(stat.totalPct/stat.sessions):50;
      g[sub]=jupebGrade(avg).grade;
    });
    return g;
  });
  const [uni,setUni]=useState("UNILAG");
  const [uniCourse,setUniCourse]=useState(user?.course||"Medicine / Surgery");
  const GRADE_PTS={A:5,B:4,C:3,D:2,E:1,F:0};
  const base=Object.values(grades).reduce((s,g)=>s+GRADE_PTS[g],0);
  const bonus=Object.values(grades).every(g=>g!=="F")&&Object.values(grades).length>0?1:0;
  const total=base+bonus;
  const selectedUniData=UNIVERSITIES_DATA.find(u=>u.shortName===uni);
  const cutoff=selectedUniData?.courses[uniCourse]?.minPoints||getRequiredPoints(uni,uniCourse)||11;
  const gap=cutoff-total;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.bg,borderRadius:"16px 16px 0 0",padding:"20px 20px 28px",width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:900,color:T.text}}>Points Calculator</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:T.muted,cursor:"pointer"}}><X size={18}/></button>
        </div>

        {userSubjects.map(sub=>(
          <div key={sub} style={{marginBottom:14}}>
            <div style={{fontSize:13,color:T.text,marginBottom:6}}>{sub}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:5}}>
              {["A","B","C","D","E","F"].map(g=>(
                <button key={g} className="btn-press" onClick={()=>setGrades(prev=>({...prev,[sub]:g}))}
                  style={{padding:"10px 0",border:`1px solid ${grades[sub]===g?T.gold:T.border}`,borderRadius:8,
                    background:grades[sub]===g?"rgba(184,151,62,0.12)":"transparent",
                    color:grades[sub]===g?T.gold:T.muted,fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,cursor:"pointer"}}>
                  {g}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div style={{background:"rgba(184,151,62,0.06)",border:`1px solid ${T.gold}33`,borderRadius:10,padding:"16px",marginTop:16,marginBottom:14,textAlign:"center"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:6}}>YOUR TOTAL</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:42,fontWeight:900,color:total>=cutoff?"#4ade80":"#f97316"}}>{total} <span style={{fontSize:18,color:T.muted}}>/ 16</span></div>
          {bonus===1&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#4ade80",marginTop:4}}>+1 bonus point — no F ✓</div>}
        </div>

        <div style={{marginBottom:8}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:8}}>COMPARE TO A TARGET</div>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <select value={uni} onChange={e=>setUni(e.target.value)} style={{flex:1,padding:"11px",borderRadius:8,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontFamily:"'DM Mono',monospace",fontSize:11}}>
              {UNIVERSITIES_DATA.map(u=><option key={u.shortName} value={u.shortName}>{u.shortName}</option>)}
            </select>
            <select value={uniCourse} onChange={e=>setUniCourse(e.target.value)} style={{flex:1,padding:"11px",borderRadius:8,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontFamily:"'DM Mono',monospace",fontSize:11}}>
              {selectedUniData?Object.keys(selectedUniData.courses).map(c=><option key={c} value={c}>{c}</option>):ALL_COURSES.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {selectedUniData&&selectedUniData.courses[uniCourse]&&(
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted}}>
              {selectedUniData.courses[uniCourse].label} · Prefers: {selectedUniData.courses[uniCourse].combination.join(", ")}
            </div>
          )}
        </div>

        <div style={{textAlign:"center",padding:"12px",fontFamily:"'DM Mono',monospace",fontSize:11,
          color:gap<=0?"#4ade80":"#f97316"}}>
          {gap<=0?`✓ You meet the ${cutoff}-point requirement`:`Gap: ${gap} pt${gap!==1?"s":""} — improve one subject by one grade to close it`}
        </div>
      </div>
    </div>
  );
}

// ─── TIMETABLE SCREEN ─────────────────────────────────────────────────────────
function TimetableScreen({user,onBack,T}) {
  const userSubjects=user.subjects||[];
  const today=new Date();today.setHours(0,0,0,0);

  return (
    <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,paddingBottom:80}}>
      <div style={{background:T.navBg,padding:"20px 22px 16px",borderBottom:`1px solid ${T.navBorder}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <button className="btn-press" onClick={onBack} style={{background:"none",border:"none",color:"rgba(247,243,236,0.5)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:10,padding:0,display:"flex",alignItems:"center",gap:4}}><ChevronLeft size={14}/> Back</button>
          <div style={{width:1,height:14,background:"rgba(255,255,255,0.1)"}}/>
          <Logo size={17} onDark={true}/>
        </div>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:"#F7F3EC"}}>2026 JUPEB Timetable</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.35)",marginTop:3}}>August 3–14, 2026 · Official schedule</div>
      </div>

      <div style={{padding:"18px",maxWidth:1000,margin:"0 auto",width:"100%"}}>
        {/* Exam countdown hero */}
        <div className="fi1" style={{background:"linear-gradient(135deg,#020D08,#061510)",border:"1px solid rgba(184,151,62,0.25)",borderRadius:12,padding:"20px 18px",marginBottom:20,textAlign:"center"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.6)",letterSpacing:"0.2em",marginBottom:8}}>TIME UNTIL FIRST EXAM</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:52,fontWeight:900,color:"#B8973E",lineHeight:1}}>{daysUntil("2026-08-03")}</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(184,151,62,0.6)",letterSpacing:"0.1em",marginTop:4}}>DAYS</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.3)",marginTop:8}}>Monday 3 August 2026 · 8:30 AM</div>
        </div>

        {/* Week 1 */}
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:12}}>WEEK 1 — MCQ / CBT</div>
        {JUPEB_TIMETABLE.slice(0,5).map(entry=>{
          const d=new Date(entry.date);d.setHours(0,0,0,0);
          const isPast=d<today,isToday=d.getTime()===today.getTime();
          const days=daysUntil(entry.date);
          const hasMySubject=entry.subjects.some(s=>userSubjects.includes(s));
          const mySubjects=entry.subjects.filter(s=>userSubjects.includes(s));
          return (
            <div key={entry.date} style={{background:hasMySubject?`${T.success}10`:T.surface,border:`1px solid ${hasMySubject?T.success+"40":T.border}`,borderRadius:10,padding:"14px 16px",marginBottom:10,opacity:isPast?0.5:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:T.text}}>{entry.label}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:entry.type==="MCQ/CBT"?T.success:T.gold,marginTop:2,letterSpacing:"0.08em"}}>{entry.type}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  {isPast?<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>DONE</div>:
                   isToday?<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.success}}>TODAY</div>:
                   <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:900,color:hasMySubject?T.success:T.muted,lineHeight:1}}>{days}<span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:400,color:T.muted}}> days</span></div>}
                </div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {entry.subjects.map(s=>{
                  const isMine=userSubjects.includes(s);
                  const meta=SUBJECT_META[s];
                  return (
                    <span key={s} style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:isMine?(meta?.color||T.success):T.muted,background:isMine?`${meta?.color||T.success}15`:`${T.muted}10`,border:`1px solid ${isMine?`${meta?.color||T.success}40`:`${T.muted}20`}`,borderRadius:4,padding:"3px 7px",fontWeight:isMine?700:400}}>
                      {s}{isMine?" ✓":""}
                    </span>
                  );
                })}
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginTop:8}}>{entry.note}</div>
            </div>
          );
        })}

        {/* Week 2 */}
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:12,marginTop:20}}>WEEK 2 — ESSAY / PRACTICAL</div>
        {JUPEB_TIMETABLE.slice(5).map(entry=>{
          const d=new Date(entry.date);d.setHours(0,0,0,0);
          const isPast=d<today,isToday=d.getTime()===today.getTime();
          const days=daysUntil(entry.date);
          const hasMySubject=entry.subjects.some(s=>userSubjects.includes(s));
          return (
            <div key={entry.date} style={{background:hasMySubject?`rgba(96,165,250,0.08)`:T.surface,border:`1px solid ${hasMySubject?"rgba(96,165,250,0.3)":T.border}`,borderRadius:10,padding:"14px 16px",marginBottom:10,opacity:isPast?0.5:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:T.text}}>{entry.label}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.gold,marginTop:2,letterSpacing:"0.08em"}}>{entry.type}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  {isPast?<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>DONE</div>:
                   <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:900,color:hasMySubject?"#60a5fa":T.muted,lineHeight:1}}>{days}<span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:400,color:T.muted}}> days</span></div>}
                </div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                {entry.subjects.map(s=>{
                  const isMine=userSubjects.includes(s);const meta=SUBJECT_META[s];
                  return (
                    <span key={s} style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:isMine?(meta?.color||"#60a5fa"):T.muted,background:isMine?`${meta?.color||"#60a5fa"}15`:`${T.muted}10`,border:`1px solid ${isMine?`${meta?.color||"#60a5fa"}40`:`${T.muted}20`}`,borderRadius:4,padding:"3px 7px",fontWeight:isMine?700:400}}>
                      {s}{isMine?" ✓":""}
                    </span>
                  );
                })}
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginTop:8}}>{entry.note}</div>
            </div>
          );
        })}

        <div style={{background:`${T.gold}07`,border:`1px solid ${T.border}`,borderRadius:8,padding:"12px 14px",marginTop:8}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.gold,letterSpacing:"0.1em",marginBottom:4}}>SOURCE</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,lineHeight:1.6}}>Official JUPEB 2026 timetable — Document ED-05. Your subjects are highlighted in colour. Verify with your institution closer to the exam.</div>
        </div>
      </div>
    </div>
  );
}

// ─── AMBASSADOR SCREEN ────────────────────────────────────────────────────────
function AmbassadorScreen({user,onBack,T}) {
  const referralCount=user?.referralCount||0;
  const currentTier=AMBASSADOR_TIERS.find(t=>referralCount>=t.min&&referralCount<=t.max)||AMBASSADOR_TIERS[0];
  const nextTier=AMBASSADOR_TIERS[AMBASSADOR_TIERS.indexOf(currentTier)+1];
  const toNext=nextTier?nextTier.min-referralCount:0;
  const [refData,setRefData]=useState(null);
  const [loading,setLoading]=useState(true);
  const referralLink=`https://credi-q.vercel.app?ref=${user?.referralCode||""}`;

  useEffect(()=>{
    if(!user?.referralCode)return;
    getDoc(doc(db,"referrals",user.referralCode)).then(snap=>{
      if(snap.exists())setRefData(snap.data());
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[user?.referralCode]);

  const signupsList=(refData?.signupsList||[]).slice().reverse();
  const paidCount=signupsList.filter(s=>s.isPaid).length;
  const freeCount=signupsList.filter(s=>!s.isPaid).length;
  const earnings=refData?.earnings||0;

  const copyLink=()=>{
    navigator.clipboard?.writeText(referralLink);
  };
  const shareLink=()=>{
    if(navigator.share){navigator.share({title:"Join me on CrediQ",text:`My guy, are you using CrediQ for JUPEB? This app is serious. Join with my link, we go prepare together 🔥\n${referralLink}`}).catch(()=>{});}
    else{navigator.clipboard?.writeText(referralLink);}
  };

  const fmt=iso=>{
    const d=new Date(iso);
    return d.toLocaleDateString("en-NG",{day:"numeric",month:"short"});
  };

  return (
    <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,paddingBottom:80}}>
      <div style={{background:T.navBg,padding:"20px 22px 16px",borderBottom:`1px solid ${T.navBorder}`}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <button className="btn-press" onClick={onBack} style={{background:"none",border:"none",color:"rgba(247,243,236,0.5)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:10,padding:0,display:"flex",alignItems:"center",gap:4}}><ChevronLeft size={14}/> Back</button>
        </div>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:700,color:"#F7F3EC"}}>Campus Ambassador</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.35)",marginTop:3}}>Tell your guys. When they join, you both move forward.</div>
      </div>

      <div style={{padding:"18px",maxWidth:1000,margin:"0 auto",width:"100%"}}>

        {/* Stats row */}
        <div className="fi1" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
          {[
            {label:"SIGNED UP",value:refData?.signups||0,color:T.gold},
            {label:"PAID",value:paidCount,color:T.success},
            {label:"EARNINGS",value:`₦${earnings.toLocaleString()}`,color:"#a78bfa"},
          ].map(s=>(
            <div key={s.label} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px 10px",textAlign:"center"}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:900,color:s.color}}>{s.value}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,marginTop:4,letterSpacing:"0.08em"}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Badge */}
        <div className="fi1" style={{background:`rgba(${currentTier.color==="#CD7F32"?"205,127,50":currentTier.color==="#C0C0C0"?"192,192,192":currentTier.color==="#FFD700"?"255,215,0":"184,151,62"},0.08)`,border:`1px solid ${currentTier.color}40`,borderRadius:12,padding:"18px 20px",textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:40,marginBottom:6}}>{currentTier.emoji}</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:900,color:currentTier.color,marginBottom:4}}>{currentTier.name} Ambassador</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,background:`${T.surface}`,borderRadius:8,padding:"6px 12px",display:"inline-block"}}>{currentTier.reward}</div>
        </div>

        {/* Progress */}
        {nextTier&&(
          <div className="fi2" style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px 16px",marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>PROGRESS TO {nextTier.name.toUpperCase()}</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:nextTier.color}}>{toNext} more</span>
            </div>
            <div style={{height:6,background:`${T.muted}22`,borderRadius:3,marginBottom:6}}>
              <div style={{height:"100%",width:`${Math.min(100,(referralCount-currentTier.min)/(nextTier.min-currentTier.min)*100)}%`,background:nextTier.color,borderRadius:3,transition:"width .8s"}}/>
            </div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>{nextTier.emoji} {nextTier.name}: {nextTier.reward}</div>
          </div>
        )}

        {/* Share link */}
        <div className="fi2" style={{background:"rgba(184,151,62,0.07)",border:"1px solid rgba(184,151,62,0.2)",borderRadius:10,padding:"16px 18px",marginBottom:16}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.12em",marginBottom:8}}>YOUR REFERRAL LINK</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.gold,marginBottom:12,wordBreak:"break-all",lineHeight:1.5}}>{referralLink}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <button className="btn-press" onClick={copyLink} style={{padding:"10px 0",border:"1px solid rgba(184,151,62,0.3)",borderRadius:8,background:"rgba(184,151,62,0.1)",color:T.gold,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer",letterSpacing:"0.08em"}}>COPY LINK</button>
            <button className="btn-press" onClick={shareLink} style={{padding:"10px 0",border:"none",borderRadius:8,background:"linear-gradient(135deg,#004B3B,#8A6A1E)",color:"#F7F3EC",fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer",letterSpacing:"0.08em"}}>SHARE NOW</button>
          </div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginTop:10}}>Code: <span style={{color:T.gold,fontWeight:700}}>{user?.referralCode}</span> — works via link or manual entry at signup</div>
        </div>

        {/* Signups list */}
        <div className="fi3" style={{marginBottom:16}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:12}}>WHO SIGNED UP — {signupsList.length} student{signupsList.length!==1?"s":""}</div>
          {loading&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textAlign:"center",padding:"20px 0"}}>Loading...</div>}
          {!loading&&signupsList.length===0&&(
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"20px",textAlign:"center"}}>
              <div style={{fontSize:28,marginBottom:8}}>👥</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>Nobody yet. Send your link to your WhatsApp group — one person joins and it starts.</div>
            </div>
          )}
          {signupsList.map((s,i)=>(
            <div key={i} style={{background:s.isPaid?`${T.success}08`:T.surface,border:`1px solid ${s.isPaid?T.success+"30":T.border}`,borderRadius:9,padding:"12px 14px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:T.text}}>{s.name}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginTop:2}}>{s.date?fmt(s.date):"—"}</div>
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,padding:"4px 10px",borderRadius:100,
                background:s.isPaid?"rgba(74,222,128,0.12)":"rgba(184,151,62,0.1)",
                color:s.isPaid?T.success:T.gold,
                border:`1px solid ${s.isPaid?T.success+"40":T.gold+"40"}`}}>
                {s.isPaid?"✓ PAID":"FREE"}
              </div>
            </div>
          ))}
        </div>

        {/* Tiers */}
        <div className="fi4">
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:12}}>AMBASSADOR TIERS</div>
          {AMBASSADOR_TIERS.map((tier)=>{
            const isActive=tier.name===currentTier.name;
            const isAchieved=referralCount>=tier.min;
            return (
              <div key={tier.name} style={{background:isActive?`${tier.color}12`:T.surface,border:`1px solid ${isActive?tier.color+"40":T.border}`,borderRadius:9,padding:"12px 14px",marginBottom:8,opacity:!isAchieved&&!isActive?0.5:1}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{fontSize:22}}>{tier.emoji}</div>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:isActive?tier.color:T.text}}>{tier.name}{isActive?" — YOU":""}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,marginTop:2}}>{tier.min}{tier.max<999?`–${tier.max}`:"+"} referrals · {tier.reward}</div>
                    </div>
                  </div>
                  {isAchieved&&<CheckCircle size={16} color={tier.color}/>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── WHY PREMIUM SCREEN ───────────────────────────────────────────────────────
function WhyPremiumScreen({user,onBack,onUpgrade,T}) {
  const daysLeft=daysUntil("2026-08-03");
  return (
    <div style={{minHeight:"100dvh",background:"#020D08",color:"#F7F3EC",paddingBottom:60}}>

      {/* Header */}
      <div style={{padding:"24px 24px 0",display:"flex",alignItems:"center",gap:12}}>
        <button className="btn-press" onClick={onBack} style={{background:"none",border:"none",color:"rgba(247,243,236,0.35)",cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontFamily:"'DM Mono',monospace",fontSize:10,padding:0}}><ChevronLeft size={14}/> Back</button>
      </div>

      {/* Hero */}
      <div style={{padding:"32px 24px 28px",textAlign:"center"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(192,57,43,0.1)",border:"1px solid rgba(192,57,43,0.2)",borderRadius:20,padding:"4px 12px",marginBottom:20}}>
          <div style={{width:5,height:5,borderRadius:"50%",background:"#ef4444"}}/>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#ef4444",letterSpacing:"0.12em"}}>{daysLeft} DAYS LEFT</span>
        </div>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:34,fontWeight:900,color:"#F7F3EC",lineHeight:1.05,marginBottom:8}}>
          Walk in ready.<br/>Not just hopeful.
        </div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(247,243,236,0.35)",letterSpacing:"0.04em"}}>
          One payment. Full access until after the last exam.
        </div>
      </div>

      {/* Cards */}
      <div style={{padding:"0 20px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:24}}>

        {/* Free */}
        <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"20px 16px"}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.35)",letterSpacing:"0.14em",marginBottom:4}}>FREE</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:900,color:"rgba(247,243,236,0.5)",marginBottom:4}}>₦0</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"rgba(247,243,236,0.25)",marginBottom:14,letterSpacing:"0.08em"}}>DIAGNOSIS</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[
              "See your readiness score",
              "Know your top 3 weak topics",
              "See which marks you're losing",
              "Drills locked — can't fix it",
              "Study plan locked",
            ].map((t,i)=>(
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8}}>
                <span style={{color:i<3?"#4ade80":"rgba(239,68,68,0.5)",fontSize:12,flexShrink:0,marginTop:1}}>{i<3?"✓":"✗"}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:i<3?"rgba(247,243,236,0.5)":"rgba(247,243,236,0.25)",lineHeight:1.5}}>{t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Premium */}
        <div style={{background:"rgba(184,151,62,0.07)",border:"1.5px solid rgba(184,151,62,0.35)",borderRadius:16,padding:"20px 16px",position:"relative"}}>
          <div style={{position:"absolute",top:-10,right:12,background:"#B8973E",borderRadius:20,padding:"2px 10px",fontFamily:"'DM Mono',monospace",fontSize:8,color:"#020D08",fontWeight:700,letterSpacing:"0.08em"}}>RECOMMENDED</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#B8973E",letterSpacing:"0.14em",marginBottom:4}}>PREMIUM ✦</div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:900,color:"#B8973E",marginBottom:4}}>₦2,500</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:"rgba(184,151,62,0.5)",marginBottom:14,letterSpacing:"0.08em"}}>DIAGNOSIS + TREATMENT</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[
              "Everything in free",
              "Unlimited targeted drills",
              "Daily next-best-action",
              "Step-by-step recovery plan",
              "Walk in confident",
            ].map((t,i)=>(
              <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8}}>
                <span style={{color:"#4ade80",fontSize:12,flexShrink:0,marginTop:1}}>✓</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:"rgba(247,243,236,0.75)",lineHeight:1.5}}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Doctor framing pill */}
      <div style={{margin:"0 20px 24px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"14px 16px",textAlign:"center"}}>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.3)",letterSpacing:"0.1em",marginBottom:8}}>THINK OF IT LIKE A DOCTOR</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:900,color:"rgba(247,243,236,0.4)"}}>Free</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.25)",marginTop:4,lineHeight:1.6}}>Diagnosis.<br/>Here's what's wrong.</div>
          </div>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:20,fontWeight:900,color:"#B8973E"}}>Premium</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.5)",marginTop:4,lineHeight:1.6}}>Treatment.<br/>Here's how we fix it.</div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{padding:"0 20px"}}>
        <BtnPrimary onClick={onUpgrade} T={T} style={{fontSize:16,padding:"16px 0"}}>
          You know what's wrong. Fix it — ₦2,500
        </BtnPrimary>
        <div style={{textAlign:"center",marginTop:12,fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.2)",lineHeight:2,letterSpacing:"0.05em"}}>
          ONCE · NO SUBSCRIPTION · NO RENEWAL<br/>
          PAYSTACK · BANK TRANSFER · INSTANT ACCESS
        </div>
      </div>
    </div>
  );
}

// ─── PROFILE SCREEN ───────────────────────────────────────────────────────────
// ─── FOUNDER DASHBOARD ────────────────────────────────────────────────────────
function FounderDashboardScreen({onBack,T,showToast}){
  const[tab,setTab]=useState("analytics"); // analytics | users | churn | email
  const[stats,setStats]=useState(null);
  const[allUsers,setAllUsers]=useState([]);
  const[loading,setLoading]=useState(true);
  const[refreshing,setRefreshing]=useState(false);
  const[error,setError]=useState("");
  // User table
  const[search,setSearch]=useState("");
  const[filter,setFilter]=useState("all"); // all|premium|free|never|inactive
  const[selectedUser,setSelectedUser]=useState(null);
  const[grantingPremium,setGrantingPremium]=useState(false);
  // Ambassador
  const[newName,setNewName]=useState("");
  const[newCode,setNewCode]=useState("");
  const[creating,setCreating]=useState(false);
  // Email
  const[emailFilter,setEmailFilter]=useState("all");
  const[emailSubject,setEmailSubject]=useState("");
  const[emailBody,setEmailBody]=useState("");
  const[sending,setSending]=useState(false);
  const[emailCount,setEmailCount]=useState(0);
  const isDesktop=useIsDesktop(900);

  const load=useCallback(async(isRefresh)=>{
    isRefresh?setRefreshing(true):setLoading(true);
    try{
      const usersSnap=await getDocs(collection(db,"users"));
      const users=usersSnap.docs.map(d=>({id:d.id,...d.data()}));
      setAllUsers(users);
      const total=users.length;
      const premium=users.filter(u=>u.isPremium).length;
      const conversion=total>0?((premium/total)*100).toFixed(1):0;
      const today=new Date().toDateString();
      const activeToday=users.filter(u=>u.lastActiveDate===today).length;
      const sessionsCompleted=users.reduce((acc,u)=>acc+(u.totalSessionsCompleted||0),0);
      const schoolMap={};users.forEach(u=>{if(u.targetUniversity){schoolMap[u.targetUniversity]=(schoolMap[u.targetUniversity]||0)+1;}});
      const topSchools=Object.entries(schoolMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
      const heardMap={};users.forEach(u=>{if(u.referralSource){heardMap[u.referralSource]=(heardMap[u.referralSource]||0)+1;}});
      const topHeard=Object.entries(heardMap).sort((a,b)=>b[1]-a[1]);
      const topicMap={};
      const sessSnap=await getDocs(collection(db,"sessions"));
      sessSnap.docs.forEach(d=>{(d.data().wrongTopics||[]).forEach(t=>{topicMap[t]=(topicMap[t]||0)+1;});});
      const topWeakTopics=Object.entries(topicMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
      const ambassSnap=await getDocs(collection(db,"ambassadors"));
      const ambassadors=ambassSnap.docs.map(d=>({id:d.id,...d.data()}));
      const totalAmbassadors=ambassadors.length;
      const totalReferred=ambassadors.reduce((a,b)=>a+(b.totalReferrals||0),0);
      const totalPremiumReferrals=ambassadors.reduce((a,b)=>a+(b.premiumReferrals||0),0);
      const totalPayouts=ambassadors.reduce((a,b)=>a+(b.earnings||0),0);
      const topAmbassadors=ambassadors.sort((a,b)=>(b.premiumReferrals||0)-(a.premiumReferrals||0)).slice(0,10)
        .map(a=>({code:a.code||a.id,name:a.name||"",referred:a.totalReferrals||0,premium:a.premiumReferrals||0,earned:a.earnings||0}));
      // Revenue — daily conversions last 30 days
      const revenueByDay={};
      users.filter(u=>u.paidAt).forEach(u=>{
        const day=new Date(u.paidAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short"});
        revenueByDay[day]=(revenueByDay[day]||0)+2500;
      });
      setStats({total,premium,conversion,activeToday,sessionsCompleted,topSchools,topWeakTopics,topHeard,totalAmbassadors,totalReferred,totalPremiumReferrals,totalPayouts,topAmbassadors,revenueByDay,totalRevenue:premium*2500});
      setError("");
    }catch(e){setError(e?.message||"Check Firestore rules — founder email needs read access.");}
    finally{setLoading(false);setRefreshing(false);}
  },[]);

  useEffect(()=>{load(false);},[load]);

  // Filtered users
  const today3=new Date();today3.setDate(today3.getDate()-3);
  const filteredUsers=useMemo(()=>{
    let list=allUsers;
    if(filter==="premium")list=list.filter(u=>u.isPremium);
    else if(filter==="free")list=list.filter(u=>!u.isPremium);
    else if(filter==="never")list=list.filter(u=>!u.totalSessionsCompleted||u.totalSessionsCompleted===0);
    else if(filter==="inactive")list=list.filter(u=>{
      if(!u.lastActiveDate)return true;
      return new Date(u.lastActiveDate)<today3;
    });
    if(search.trim()){
      const q=search.toLowerCase();
      list=list.filter(u=>(u.name||"").toLowerCase().includes(q)||(u.email||"").toLowerCase().includes(q)||(u.targetUniversity||"").toLowerCase().includes(q));
    }
    return list.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  },[allUsers,filter,search]);

  // Email recipient count
  useEffect(()=>{
    if(emailFilter==="all")setEmailCount(allUsers.filter(u=>u.email).length);
    else if(emailFilter==="premium")setEmailCount(allUsers.filter(u=>u.isPremium&&u.email).length);
    else if(emailFilter==="free")setEmailCount(allUsers.filter(u=>!u.isPremium&&u.email).length);
    else if(emailFilter==="inactive")setEmailCount(allUsers.filter(u=>u.email&&(!u.totalSessionsCompleted||u.totalSessionsCompleted===0)).length);
  },[emailFilter,allUsers]);

  const grantPremium=async(targetUser,revoke)=>{
    setGrantingPremium(true);
    try{
      const updates=revoke?{isPremium:false,premiumExpiry:null}:{isPremium:true,premiumExpiry:null,referralUnlock:"founder_grant"};
      await updateDoc(doc(db,"users",targetUser.id),updates);
      setAllUsers(prev=>prev.map(u=>u.id===targetUser.id?{...u,...updates}:u));
      setSelectedUser(u=>({...u,...updates}));
      showToast?.(revoke?"Premium revoked":"Premium granted ✓","success");
    }catch(e){showToast?.("Failed — check Firestore rules","error");}
    setGrantingPremium(false);
  };

  const resetProfileEdits=async(targetUser)=>{
    try{
      await updateDoc(doc(db,"users",targetUser.id),{profileEdits:0});
      setAllUsers(prev=>prev.map(u=>u.id===targetUser.id?{...u,profileEdits:0}:u));
      setSelectedUser(u=>({...u,profileEdits:0}));
      showToast?.("Profile edits reset — next edit is free","success");
    }catch{showToast?.("Failed","error");}
  };

  const sendEmail=async()=>{
    if(!emailSubject.trim()||!emailBody.trim()){showToast?.("Fill in subject and body","error");return;}
    const apiKey=import.meta.env.VITE_BREVO_API_KEY;
    if(!apiKey){showToast?.("Add VITE_BREVO_API_KEY to Vercel environment variables","error");return;}
    setSending(true);
    try{
      let recipients=allUsers.filter(u=>u.email);
      if(emailFilter==="premium")recipients=recipients.filter(u=>u.isPremium);
      else if(emailFilter==="free")recipients=recipients.filter(u=>!u.isPremium);
      else if(emailFilter==="inactive")recipients=recipients.filter(u=>!u.totalSessionsCompleted||u.totalSessionsCompleted===0);
      // Send via Brevo batch (max 50 per call to avoid rate limits)
      const chunks=[];
      for(let i=0;i<recipients.length;i+=50)chunks.push(recipients.slice(i,i+50));
      let sent=0;
      for(const chunk of chunks){
        const res=await fetch("https://api.brevo.com/v3/smtp/email",{
          method:"POST",
          headers:{"Content-Type":"application/json","api-key":apiKey},
          body:JSON.stringify({
            sender:{name:"CrediQ",email:"noreply@credi-q.vercel.app"},
            to:chunk.map(u=>({email:u.email,name:u.name||"Student"})),
            subject:emailSubject,
            htmlContent:`<div style="font-family:system-ui;max-width:600px;margin:0 auto;padding:24px;background:#0a1410;color:#F7F3EC;border-radius:12px">
              <img src="https://credi-q.vercel.app/icon-192.png" width="48" style="border-radius:10px;margin-bottom:16px"/><br/>
              ${emailBody.replace(/\n/g,"<br/>")}
              <br/><br/><hr style="border-color:rgba(184,151,62,0.2)"/>
              <p style="font-size:12px;color:#9AA89A">CrediQ · JUPEB Preparation · <a href="https://credi-q.vercel.app" style="color:#B8973E">credi-q.vercel.app</a></p>
            </div>`
          })
        });
        if(!res.ok){const e=await res.text();throw new Error(e);}
        sent+=chunk.length;
      }
      showToast?.(`Sent to ${sent} students ✓`,"success");
      setEmailSubject("");setEmailBody("");
    }catch(e){showToast?.(`Failed: ${e.message}`,"error");}
    setSending(false);
  };

  const copyAmbassadorLink=code=>{
    const link=`https://credi-q.vercel.app?ref=${code}`;
    navigator.clipboard?.writeText(link).then(()=>showToast?.("Link copied!","success")).catch(()=>showToast?.("Couldn't copy","error"));
  };

  const slugify=s=>s.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,12);

  const createAmbassador=async()=>{
    const code=(newCode.trim()?slugify(newCode):slugify(newName));
    if(!code){showToast?.("Enter a name or code first","error");return;}
    setCreating(true);
    try{
      const existing=await getDoc(doc(db,"ambassadors",code));
      if(existing.exists()){showToast?.("That code already exists","error");setCreating(false);return;}
      await setDoc(doc(db,"ambassadors",code),{code,name:newName.trim()||code,totalReferrals:0,premiumReferrals:0,earnings:0,createdAt:new Date().toISOString()});
      showToast?.(`Ambassador "${code}" created`,"success");
      setNewName("");setNewCode("");load(true);
    }catch(e){showToast?.("Couldn't create — check Firestore rules","error");}
    setCreating(false);
  };

  const StatCard=({label,value,sub,color="#B8973E"})=>(
    <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"18px 16px"}}>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,letterSpacing:"0.14em",marginBottom:6}}>{label}</div>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:color||T.gold,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,marginTop:4}}>{sub}</div>}
    </div>
  );

  const RankList=({title,items,emptyMsg})=>(
    <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"18px 16px",marginBottom:12}}>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:12}}>{title}</div>
      {items.length===0?<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{emptyMsg||"No data yet"}</div>
        :items.map(([name,count],i)=>(
          <div key={name} style={{display:"flex",alignItems:"center",gap:10,marginBottom:i<items.length-1?10:0}}>
            <div style={{width:22,height:22,borderRadius:6,background:i===0?"rgba(184,151,62,0.2)":"rgba(255,255,255,0.04)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontSize:9,color:i===0?T.gold:T.muted,fontWeight:700,flexShrink:0}}>{i+1}</div>
            <div style={{flex:1,fontSize:13,color:T.text,fontWeight:i===0?600:400}}>{name}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{count}</div>
          </div>
        ))
      }
    </div>
  );

  const TABS=[
    {id:"analytics",label:"ANALYTICS"},
    {id:"users",label:`USERS (${allUsers.length})`},
    {id:"churn",label:"CHURN"},
    {id:"email",label:"EMAIL"},
  ];

  return(
    <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,paddingBottom:60}}>
      {/* Header */}
      <div style={{background:T.navBg,borderBottom:`1px solid ${T.navBorder}`}}>
        <div style={{padding:"20px 20px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",padding:0}}><ChevronLeft size={22} color={T.muted}/></button>
            <div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:900,color:T.gold}}>Founder Dashboard</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.gold}60`,letterSpacing:"0.15em",marginTop:2}}>CREDIQ · LIVE ANALYTICS</div>
            </div>
          </div>
          <button onClick={()=>load(true)} disabled={refreshing||loading} className="btn-press" style={{display:"flex",alignItems:"center",gap:6,background:"rgba(184,151,62,0.1)",border:`1px solid ${T.border}`,borderRadius:20,padding:"7px 12px",cursor:"pointer",opacity:refreshing?0.6:1}}>
            <RefreshCw size={12} color={T.gold} style={refreshing?{animation:"spin 0.8s linear infinite"}:{}}/>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.gold,fontWeight:700}}>{refreshing?"...":"REFRESH"}</span>
          </button>
        </div>
        {/* Tabs */}
        <div style={{display:"flex",gap:0,overflowX:"auto",paddingBottom:1}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flexShrink:0,padding:"10px 18px",background:"none",border:"none",
              borderBottom:`2px solid ${tab===t.id?T.gold:"transparent"}`,
              color:tab===t.id?T.gold:T.muted,
              fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:tab===t.id?700:400,
              cursor:"pointer",letterSpacing:"0.1em",transition:"all 0.2s"
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{padding:isDesktop?"24px 40px":"18px",maxWidth:isDesktop?1200:700,margin:"0 auto"}}>
        {loading?<div style={{textAlign:"center",padding:60}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,letterSpacing:"0.15em"}}>LOADING DATA…</div></div>
        :error?<div style={{background:"rgba(192,57,43,0.08)",border:"1px solid rgba(192,57,43,0.3)",borderRadius:12,padding:"20px",marginTop:20}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.danger,marginBottom:8}}>ERROR</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,lineHeight:1.7}}>{error}</div></div>
        :!stats?<div style={{textAlign:"center",padding:60}}><div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>No data.</div></div>
        :(
          <>
            {/* ── ANALYTICS TAB ── */}
            {tab==="analytics"&&(
              <div style={{display:isDesktop?"grid":"block",gridTemplateColumns:"1fr 340px",gap:24,alignItems:"start"}}>
                <div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:10}}>OVERVIEW</div>
                  <div style={{display:"grid",gridTemplateColumns:isDesktop?"repeat(3,1fr)":"1fr 1fr",gap:10,marginBottom:20}}>
                    <StatCard label="TOTAL STUDENTS" value={stats.total}/>
                    <StatCard label="PREMIUM USERS" value={stats.premium} color="#4ade80"/>
                    <StatCard label="CONVERSION RATE" value={`${stats.conversion}%`} color="#B8973E"/>
                    <StatCard label="ACTIVE TODAY" value={stats.activeToday} color="#60a5fa"/>
                    <StatCard label="SESSIONS COMPLETED" value={stats.sessionsCompleted} sub="across all users"/>
                    <StatCard label="TOTAL REVENUE" value={`₦${stats.totalRevenue.toLocaleString()}`} color="#4ade80"/>
                  </div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",margin:"20px 0 10px"}}>REFERRAL & AMBASSADOR</div>
                  <div style={{display:"grid",gridTemplateColumns:isDesktop?"repeat(3,1fr)":"1fr 1fr",gap:10,marginBottom:20}}>
                    <StatCard label="TOTAL AMBASSADORS" value={stats.totalAmbassadors}/>
                    <StatCard label="REFERRED USERS" value={stats.totalReferred}/>
                    <StatCard label="PREMIUM REFERRALS" value={stats.totalPremiumReferrals} color="#4ade80"/>
                    <StatCard label="REFERRAL REVENUE" value={`₦${(stats.totalPremiumReferrals*2500).toLocaleString()}`} color="#B8973E"/>
                    <StatCard label="AMBASSADOR PAYOUTS" value={`₦${stats.totalPayouts.toLocaleString()}`} color="#f97316"/>
                  </div>
                  <div style={{display:isDesktop?"grid":"block",gridTemplateColumns:"1fr 1fr",gap:16}}>
                    <RankList title="MOST SELECTED SCHOOLS" items={stats.topSchools} emptyMsg="No school data yet"/>
                    <RankList title="HOW STUDENTS FOUND CREDIQ" items={stats.topHeard} emptyMsg="No referral data yet"/>
                  </div>
                  <RankList title="TOP WEAK TOPICS" items={stats.topWeakTopics} emptyMsg="No session data yet"/>
                </div>
                {/* Right: Ambassador management */}
                <div>
                  <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px",marginBottom:12}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:10}}>+ NEW AMBASSADOR</div>
                    <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Name (e.g. Ella - UNILAG)" style={{width:"100%",padding:"9px 10px",marginBottom:8,background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:12,fontFamily:"sans-serif",boxSizing:"border-box"}}/>
                    <input value={newCode} onChange={e=>setNewCode(e.target.value)} placeholder="Code (optional)" style={{width:"100%",padding:"9px 10px",marginBottom:10,background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:12,fontFamily:"'DM Mono',monospace",letterSpacing:"0.05em",boxSizing:"border-box"}}/>
                    <button onClick={createAmbassador} disabled={creating} className="btn-press" style={{width:"100%",padding:"10px",background:"rgba(184,151,62,0.15)",border:`1px solid ${T.gold}50`,borderRadius:8,color:T.gold,fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,cursor:"pointer",letterSpacing:"0.06em"}}>
                      {creating?"CREATING...":"CREATE AMBASSADOR"}
                    </button>
                  </div>
                  <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"18px 16px"}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:14}}>🏆 TOP AMBASSADORS</div>
                    {stats.topAmbassadors.length===0?<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>No ambassadors yet.</div>
                      :stats.topAmbassadors.map((a,i)=>(
                        <div key={a.code} style={{display:"flex",alignItems:"center",gap:10,marginBottom:i<stats.topAmbassadors.length-1?14:0,paddingBottom:i<stats.topAmbassadors.length-1?14:0,borderBottom:i<stats.topAmbassadors.length-1?`1px solid ${T.border}`:"none"}}>
                          <div style={{width:26,height:26,borderRadius:8,background:i===0?"rgba(184,151,62,0.2)":"rgba(255,255,255,0.04)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontSize:10,color:i===0?T.gold:T.muted,fontWeight:700,flexShrink:0}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name||a.code}</div>
                            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,marginTop:3}}>{a.referred} REF · {a.premium} PREMIUM</div>
                          </div>
                          <button onClick={()=>copyAmbassadorLink(a.code)} className="btn-press" style={{background:"rgba(255,255,255,0.04)",border:`1px solid ${T.border}`,borderRadius:7,padding:6,cursor:"pointer",display:"flex",alignItems:"center"}}><Copy size={12} color={T.muted}/></button>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:T.gold}}>₦{a.earned.toLocaleString()}</div>
                            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted}}>EARNED</div>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              </div>
            )}

            {/* ── USERS TAB ── */}
            {tab==="users"&&(
              <div>
                {/* Search + filters */}
                <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
                  <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, email, school…"
                    style={{flex:"1 1 200px",padding:"10px 14px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontFamily:"'DM Mono',monospace",fontSize:11,outline:"none"}}/>
                  {["all","premium","free","never","inactive"].map(f=>(
                    <button key={f} onClick={()=>setFilter(f)} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${filter===f?T.gold:T.border}`,background:filter===f?`${T.gold}12`:"transparent",color:filter===f?T.gold:T.muted,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer",letterSpacing:"0.06em",flexShrink:0}}>
                      {f==="never"?"NEVER PRACTICED":f==="inactive"?"INACTIVE 3D+":f.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginBottom:10}}>{filteredUsers.length} students</div>
                {/* User rows */}
                <div>
                  {filteredUsers.map(u=>(
                    <div key={u.id} onClick={()=>setSelectedUser(u)} className="btn-press"
                      style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8,cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                          <div style={{fontSize:14,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name||"No name"}</div>
                          {u.isPremium&&<div style={{flexShrink:0,background:"rgba(74,222,128,0.15)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:10,padding:"2px 8px",fontFamily:"'DM Mono',monospace",fontSize:7,color:"#4ade80"}}>PREMIUM</div>}
                        </div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>{u.targetUniversity||"—"}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}60`,marginTop:2}}>{u.totalSessionsCompleted||0} sessions</div>
                      </div>
                      <ChevronRight size={14} color={`${T.muted}50`}/>
                    </div>
                  ))}
                  {filteredUsers.length===0&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,textAlign:"center",padding:40}}>No students match this filter.</div>}
                </div>

                {/* ── USER DETAIL MODAL ── */}
                {selectedUser&&(
                  <div style={{position:"fixed",inset:0,zIndex:600,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(4px)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}
                    onClick={e=>{if(e.target===e.currentTarget)setSelectedUser(null);}}>
                    <motion.div initial={{y:400}} animate={{y:0}} exit={{y:400}} transition={{type:"spring",stiffness:280,damping:28}}
                      style={{width:"100%",maxWidth:540,background:T.bg,borderRadius:"20px 20px 0 0",padding:"0 0 env(safe-area-inset-bottom,0)",maxHeight:"90dvh",overflowY:"auto",boxShadow:"0 -20px 60px rgba(0,0,0,0.5)"}}>
                      <div style={{position:"sticky",top:0,background:T.bg,padding:"14px 18px 12px",borderBottom:`1px solid ${T.border}`,zIndex:1}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:900,color:T.text}}>{selectedUser.name||"Student"}</div>
                          <button onClick={()=>setSelectedUser(null)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:20}}>✕</button>
                        </div>
                      </div>
                      <div style={{padding:"18px"}}>
                        {[
                          ["Email",selectedUser.email],
                          ["School",selectedUser.targetUniversity||"—"],
                          ["Course",selectedUser.course||"—"],
                          ["Subjects",(selectedUser.subjects||[]).join(", ")||"—"],
                          ["Sessions",selectedUser.totalSessionsCompleted||0],
                          ["Last Active",selectedUser.lastActiveDate||"Never"],
                          ["Referred By",selectedUser.referredBy||"Direct"],
                          ["Referrals Made",selectedUser.referralCount||0],
                          ["Profile Edits",selectedUser.profileEdits||0],
                          ["Joined",selectedUser.createdAt?.toDate?.().toLocaleDateString("en-GB")||"—"],
                          ["How Found",selectedUser.referralSource||"—"],
                        ].map(([k,v])=>(
                          <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${T.border}`}}>
                            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.1em"}}>{k.toUpperCase()}</div>
                            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.text,textAlign:"right",maxWidth:"60%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{String(v)}</div>
                          </div>
                        ))}
                        <div style={{display:"flex",gap:10,marginTop:18}}>
                          <button onClick={()=>grantPremium(selectedUser,selectedUser.isPremium)} disabled={grantingPremium} className="btn-press"
                            style={{flex:1,padding:"12px 0",border:`1px solid ${selectedUser.isPremium?"rgba(239,68,68,0.4)":"rgba(74,222,128,0.4)"}`,borderRadius:8,background:selectedUser.isPremium?"rgba(239,68,68,0.08)":"rgba(74,222,128,0.08)",color:selectedUser.isPremium?"#ef4444":"#4ade80",fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,cursor:"pointer"}}>
                            {grantingPremium?"...":(selectedUser.isPremium?"REVOKE PREMIUM":"GRANT PREMIUM")}
                          </button>
                          <button onClick={()=>resetProfileEdits(selectedUser)} className="btn-press"
                            style={{flex:1,padding:"12px 0",border:`1px solid ${T.border}`,borderRadius:8,background:"transparent",color:T.muted,fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer"}}>
                            RESET EDITS
                          </button>
                        </div>
                        <button onClick={()=>{navigator.clipboard?.writeText(selectedUser.email);showToast?.("Email copied","success");}} className="btn-press"
                          style={{width:"100%",marginTop:10,padding:"12px 0",border:`1px solid ${T.border}`,borderRadius:8,background:"transparent",color:T.muted,fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer"}}>
                          COPY EMAIL
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </div>
            )}

            {/* ── CHURN TAB ── */}
            {tab==="churn"&&(()=>{
              const neverPracticed=allUsers.filter(u=>!u.totalSessionsCompleted||u.totalSessionsCompleted===0);
              const inactive=allUsers.filter(u=>{
                if(!u.lastActiveDate)return true;
                const d=new Date(u.lastActiveDate);
                return(Date.now()-d.getTime())>3*24*60*60*1000;
              });
              const copyEmails=list=>{
                const emails=list.map(u=>u.email).filter(Boolean).join(",");
                navigator.clipboard?.writeText(emails).then(()=>showToast?.(`${list.length} emails copied`,"success")).catch(()=>showToast?.("Couldn't copy","error"));
              };
              const ChurnList=({title,color,list,msg})=>(
                <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"18px",marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color,letterSpacing:"0.14em",marginBottom:4}}>{title}</div>
                      <div style={{fontFamily:"'Playfair Display',serif",fontSize:24,fontWeight:900,color}}>{list.length}</div>
                    </div>
                    <button onClick={()=>copyEmails(list)} className="btn-press" style={{padding:"8px 14px",border:`1px solid ${T.border}`,borderRadius:8,background:"transparent",color:T.muted,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer"}}>
                      COPY EMAILS
                    </button>
                  </div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,lineHeight:1.8,marginBottom:12}}>{msg}</div>
                  {list.slice(0,8).map(u=>(
                    <div key={u.id} onClick={()=>setSelectedUser(u)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${T.border}`,cursor:"pointer"}}>
                      <div style={{fontSize:13,color:T.text}}>{u.name||"—"}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>{u.targetUniversity||"—"}</div>
                    </div>
                  ))}
                  {list.length>8&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}60`,marginTop:10,textAlign:"center"}}>+{list.length-8} more</div>}
                </div>
              );
              return(
                <div>
                  <ChurnList title="NEVER PRACTICED" color="#f97316" list={neverPracticed} msg="Signed up but never completed a session. Reach out with a personal message — these are your warmest leads."/>
                  <ChurnList title="INACTIVE 3+ DAYS" color="#60a5fa" list={inactive} msg="Were active but went quiet. With 45 days to exam, urgency is your message."/>
                </div>
              );
            })()}

            {/* ── EMAIL TAB ── */}
            {tab==="email"&&(
              <div style={{maxWidth:600}}>
                <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"18px",marginBottom:16}}>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:14}}>SEND TO</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
                    {[
                      {v:"all",l:"All Students"},
                      {v:"premium",l:"Premium Only"},
                      {v:"free",l:"Free Only"},
                      {v:"inactive",l:"Never Practiced"},
                    ].map(({v,l})=>(
                      <button key={v} onClick={()=>setEmailFilter(v)} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${emailFilter===v?T.gold:T.border}`,background:emailFilter===v?`${T.gold}12`:"transparent",color:emailFilter===v?T.gold:T.muted,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer"}}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.gold,marginBottom:16}}>~{emailCount} recipients</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:8}}>SUBJECT</div>
                  <input value={emailSubject} onChange={e=>setEmailSubject(e.target.value)} placeholder="e.g. Your JUPEB exam is in 45 days 🔥"
                    style={{width:"100%",padding:"11px 14px",marginBottom:14,background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontFamily:"'DM Mono',monospace",fontSize:11,outline:"none",boxSizing:"border-box"}}/>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:8}}>MESSAGE BODY</div>
                  <textarea value={emailBody} onChange={e=>setEmailBody(e.target.value)} placeholder="Write your email here. Tip: come to Claude to write it, paste it here."
                    rows={10} style={{width:"100%",padding:"11px 14px",background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontFamily:"'DM Mono',monospace",fontSize:11,outline:"none",resize:"vertical",lineHeight:1.7,boxSizing:"border-box"}}/>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}50`,marginTop:8,marginBottom:16,lineHeight:1.8}}>
                    Sends via Brevo API. Add VITE_BREVO_API_KEY to Vercel environment variables first.<br/>
                    Sign up free at brevo.com — 300 emails/day forever.
                  </div>
                  <button onClick={sendEmail} disabled={sending||!emailSubject.trim()||!emailBody.trim()} className="btn-press"
                    style={{width:"100%",padding:"14px 0",border:"none",borderRadius:10,background:emailSubject.trim()&&emailBody.trim()?"linear-gradient(135deg,#004B3B,#8A6A1E)":"rgba(255,255,255,0.06)",color:emailSubject.trim()&&emailBody.trim()?"#F7F3EC":`${T.muted}60`,fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,cursor:emailSubject.trim()&&emailBody.trim()?"pointer":"not-allowed"}}>
                    {sending?`Sending to ${emailCount} students…`:`Send to ${emailCount} students →`}
                  </button>
                </div>
              </div>
            )}

            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}40`,textAlign:"center",margin:"24px 0",lineHeight:1.8,letterSpacing:"0.08em"}}>
              LIVE FROM FIRESTORE · ONLY VISIBLE TO FOUNDER ACCOUNT
            </div>
          </>
        )}
      </div>
    </div>
  );
}

  const load=useCallback(async(isRefresh)=>{
    isRefresh?setRefreshing(true):setLoading(true);
    try{
      // Fetch all users
      const usersSnap=await getDocs(collection(db,"users"));
      const users=usersSnap.docs.map(d=>({id:d.id,...d.data()}));
      const total=users.length;
      const premium=users.filter(u=>u.isPremium).length;
      const conversion=total>0?((premium/total)*100).toFixed(1):0;

      // Active today — matches the toDateString() format used when saving lastActiveDate
      const today=new Date().toDateString();
      const activeToday=users.filter(u=>u.lastActiveDate===today).length;

      // Sessions (from sessions collection or history sub-collection count via users.sessionsCompleted field)
      const sessionsCompleted=users.reduce((acc,u)=>acc+(u.totalSessionsCompleted||0),0);

      // School counts
      const schoolMap={};
      users.forEach(u=>{if(u.targetUniversity){schoolMap[u.targetUniversity]=(schoolMap[u.targetUniversity]||0)+1;}});
      const topSchools=Object.entries(schoolMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

      // Referral sources
      const heardMap={};
      users.forEach(u=>{if(u.referralSource){heardMap[u.referralSource]=(heardMap[u.referralSource]||0)+1;}});
      const topHeard=Object.entries(heardMap).sort((a,b)=>b[1]-a[1]);

      // Weak topics — pull from sessions collection if it exists, else from user history
      const topicMap={};
      const sessSnap=await getDocs(collection(db,"sessions"));
      sessSnap.docs.forEach(d=>{
        const data=d.data();
        (data.wrongTopics||[]).forEach(t=>{topicMap[t]=(topicMap[t]||0)+1;});
      });
      const topWeakTopics=Object.entries(topicMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

      // ── AMBASSADOR / REFERRAL ANALYTICS ──
      const ambassSnap=await getDocs(collection(db,"ambassadors"));
      const ambassadors=ambassSnap.docs.map(d=>({id:d.id,...d.data()}));
      const totalAmbassadors=ambassadors.length;
      const totalReferred=ambassadors.reduce((a,b)=>a+(b.totalReferrals||0),0);
      const totalPremiumReferrals=ambassadors.reduce((a,b)=>a+(b.premiumReferrals||0),0);
      const totalPayouts=ambassadors.reduce((a,b)=>a+(b.earnings||0),0);
      const topAmbassadors=ambassadors
        .sort((a,b)=>(b.premiumReferrals||0)-(a.premiumReferrals||0))
        .slice(0,10)
        .map(a=>({code:a.code||a.id,name:a.name||"",referred:a.totalReferrals||0,premium:a.premiumReferrals||0,earned:a.earnings||0}));

      setStats({total,premium,conversion,activeToday,sessionsCompleted,topSchools,topWeakTopics,topHeard,totalAmbassadors,totalReferred,totalPremiumReferrals,totalPayouts,topAmbassadors});
      setError("");
    }catch(e){
      console.error("Founder stats error:",e);
      setError(e?.message||"Failed to load data. Check Firestore rules — your account may need read access to all users.");
    }
    finally{setLoading(false);setRefreshing(false);}
  },[]);

  useEffect(()=>{load(false);},[load]);

  const copyAmbassadorLink=code=>{
    const link=`https://credi-q.vercel.app?ref=${code}`;
    navigator.clipboard?.writeText(link).then(()=>showToast?.("Link copied!","success")).catch(()=>showToast?.("Couldn't copy — long-press to select instead","error"));
  };

  const slugify=s=>s.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,12);

  const createAmbassador=async()=>{
    const code=(newCode.trim()?slugify(newCode):slugify(newName));
    if(!code){showToast?.("Enter a name or code first","error");return;}
    setCreating(true);
    try{
      const existing=await getDoc(doc(db,"ambassadors",code));
      if(existing.exists()){showToast?.("That code already exists","error");setCreating(false);return;}
      await setDoc(doc(db,"ambassadors",code),{
        code,name:newName.trim()||code,
        totalReferrals:0,premiumReferrals:0,earnings:0,
        createdAt:new Date().toISOString(),
      });
      showToast?.(`Ambassador "${code}" created`,"success");
      setNewName("");setNewCode("");
      load(true);
    }catch(e){
      console.error("Create ambassador error:",e);
      showToast?.("Couldn't create — check Firestore rules","error");
    }
    setCreating(false);
  };

  const StatCard=({label,value,sub,color="#B8973E"})=>(
    <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"18px 16px",flex:"1 1 140px"}}>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,letterSpacing:"0.14em",marginBottom:6}}>{label}</div>
      <div style={{fontFamily:"'Playfair Display',serif",fontSize:28,fontWeight:900,color:color||T.gold,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,marginTop:4}}>{sub}</div>}
    </div>
  );

  const RankList=({title,items,emptyMsg})=>(
    <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"18px 16px",marginBottom:12}}>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:12}}>{title}</div>
      {items.length===0
        ?<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{emptyMsg||"No data yet"}</div>
        :items.map(([name,count],i)=>(
          <div key={name} style={{display:"flex",alignItems:"center",gap:10,marginBottom:i<items.length-1?10:0}}>
            <div style={{width:22,height:22,borderRadius:6,background:i===0?"rgba(184,151,62,0.2)":"rgba(255,255,255,0.04)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontSize:9,color:i===0?T.gold:T.muted,fontWeight:700,flexShrink:0}}>{i+1}</div>
            <div style={{flex:1,fontSize:13,color:T.text,fontWeight:i===0?600:400}}>{name}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{count}</div>
          </div>
        ))
      }
    </div>
  );

  return(
    <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,paddingBottom:60}}>
      {/* Header */}
      <div style={{background:T.navBg,padding:"20px 20px 16px",borderBottom:`1px solid ${T.navBorder}`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:T.muted,padding:0}}>
              <ChevronLeft size={22} color={T.muted}/>
            </button>
            <div>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:900,color:T.gold}}>Founder Dashboard</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.gold}60`,letterSpacing:"0.15em",marginTop:2}}>CREDIQ · LIVE ANALYTICS</div>
            </div>
          </div>
          <button onClick={()=>load(true)} disabled={refreshing||loading} className="btn-press" style={{display:"flex",alignItems:"center",gap:6,background:"rgba(184,151,62,0.1)",border:`1px solid ${T.border}`,borderRadius:20,padding:"7px 12px",cursor:refreshing?"default":"pointer",opacity:refreshing?0.6:1,flexShrink:0}}>
            <RefreshCw size={12} color={T.gold} style={refreshing?{animation:"spin 0.8s linear infinite"}:{}}/>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.gold,fontWeight:700}}>{refreshing?"...":"REFRESH"}</span>
          </button>
        </div>
      </div>

      <div style={{padding:isDesktop?"24px 40px 0":"18px",maxWidth:isDesktop?1200:700,margin:"0 auto"}}>
        {loading?(
          <div style={{textAlign:"center",padding:60}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,letterSpacing:"0.15em"}}>LOADING DATA…</div>
          </div>
        ):error?(
          <div style={{background:"rgba(192,57,43,0.08)",border:"1px solid rgba(192,57,43,0.3)",borderRadius:12,padding:"20px 18px",marginTop:20}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.danger,letterSpacing:"0.12em",marginBottom:8}}>ERROR LOADING DATA</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted,lineHeight:1.7}}>{error}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:`${T.muted}70`,marginTop:12,lineHeight:1.7}}>
              Fix: In your Firestore rules, allow your founder email to read all users. Or check the browser console for the exact error.
            </div>
          </div>
        ):!stats?(
          <div style={{textAlign:"center",padding:60}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>No data returned.</div>
          </div>
        ):(
          <div style={{display:isDesktop?"grid":"block",gridTemplateColumns:"1fr 340px",gap:24,alignItems:"start"}}>

            {/* ── LEFT / MAIN COLUMN ── */}
            <div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:10}}>OVERVIEW</div>
              <div style={{display:"grid",gridTemplateColumns:isDesktop?"repeat(3,1fr)":"1fr 1fr",gap:10,marginBottom:20}}>
                <StatCard label="TOTAL STUDENTS" value={stats.total}/>
                <StatCard label="PREMIUM USERS" value={stats.premium} color="#4ade80"/>
                <StatCard label="CONVERSION RATE" value={`${stats.conversion}%`} color="#B8973E"/>
                <StatCard label="ACTIVE TODAY" value={stats.activeToday} color="#60a5fa"/>
                <StatCard label="SESSIONS COMPLETED" value={stats.sessionsCompleted} sub="across all users"/>
              </div>

              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",margin:"20px 0 10px"}}>REFERRAL & AMBASSADOR ANALYTICS</div>
              <div style={{display:"grid",gridTemplateColumns:isDesktop?"repeat(3,1fr)":"1fr 1fr",gap:10,marginBottom:20}}>
                <StatCard label="TOTAL AMBASSADORS" value={stats.totalAmbassadors}/>
                <StatCard label="REFERRED USERS" value={stats.totalReferred}/>
                <StatCard label="PREMIUM REFERRALS" value={stats.totalPremiumReferrals} color="#4ade80"/>
                <StatCard label="REFERRAL REVENUE" value={`₦${(stats.totalPremiumReferrals*2500).toLocaleString()}`} color="#B8973E" sub="₦2,500 × premium referrals"/>
                <StatCard label="AMBASSADOR PAYOUTS" value={`₦${stats.totalPayouts.toLocaleString()}`} color="#f97316" sub={`₦${AMBASSADOR_COMMISSION} per conversion`}/>
              </div>

              <div style={{display:isDesktop?"grid":"block",gridTemplateColumns:"1fr 1fr",gap:16}}>
                <RankList title="MOST SELECTED SCHOOLS" items={stats.topSchools} emptyMsg="No school data yet"/>
                <RankList title="HOW STUDENTS FOUND CREDIQ" items={stats.topHeard} emptyMsg="No referral source data yet"/>
              </div>

              <RankList title="TOP WEAK TOPICS" items={stats.topWeakTopics} emptyMsg="No session data yet"/>
            </div>

            {/* ── RIGHT COLUMN — ambassador leaderboard ── */}
            <div>
              <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"16px",marginBottom:12}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:10}}>+ NEW AMBASSADOR</div>
                <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Name (e.g. Chidi - UNILAG)" style={{width:"100%",padding:"9px 10px",marginBottom:8,background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:12,fontFamily:"'DM Sans',sans-serif"}}/>
                <input value={newCode} onChange={e=>setNewCode(e.target.value)} placeholder="Code (optional — auto from name)" style={{width:"100%",padding:"9px 10px",marginBottom:10,background:T.bg,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:12,fontFamily:"'DM Mono',monospace",letterSpacing:"0.05em"}}/>
                <button onClick={createAmbassador} disabled={creating} className="btn-press" style={{width:"100%",padding:"10px",background:"rgba(184,151,62,0.15)",border:`1px solid ${T.gold}50`,borderRadius:8,color:T.gold,fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,cursor:creating?"default":"pointer",letterSpacing:"0.06em"}}>
                  {creating?"CREATING...":"CREATE AMBASSADOR"}
                </button>
              </div>

              <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"18px 16px",marginBottom:isDesktop?0:12}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:14}}>🏆 TOP AMBASSADORS</div>
                {stats.topAmbassadors.length===0
                  ?<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>No ambassadors yet — create one above.</div>
                  :stats.topAmbassadors.map((a,i)=>(
                    <div key={a.code} style={{display:"flex",alignItems:"center",gap:10,marginBottom:i<stats.topAmbassadors.length-1?14:0,paddingBottom:i<stats.topAmbassadors.length-1?14:0,borderBottom:i<stats.topAmbassadors.length-1?`1px solid ${T.border}`:"none"}}>
                      <div style={{width:26,height:26,borderRadius:8,background:i===0?"rgba(184,151,62,0.2)":i===1?"rgba(192,192,192,0.1)":"rgba(255,255,255,0.04)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontSize:10,color:i===0?T.gold:T.muted,fontWeight:700,flexShrink:0}}>
                        {i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name||a.code}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,marginTop:3,letterSpacing:"0.06em"}}>
                          {a.referred} REFERRED · {a.premium} PREMIUM
                        </div>
                      </div>
                      <button onClick={()=>copyAmbassadorLink(a.code)} className="btn-press" title="Copy referral link" style={{background:"rgba(255,255,255,0.04)",border:`1px solid ${T.border}`,borderRadius:7,padding:6,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center"}}>
                        <Copy size={12} color={T.muted}/>
                      </button>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:T.gold}}>₦{a.earned.toLocaleString()}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,marginTop:2}}>EARNED</div>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>

          </div>
        )}
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}60`,textAlign:"center",margin:"24px 0",lineHeight:1.8,letterSpacing:"0.08em"}}>
          LIVE FROM FIRESTORE · ONLY VISIBLE TO FOUNDER ACCOUNT
        </div>
      </div>
    </div>
  );
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
// ─── EDIT PROFILE SCREEN ─────────────────────────────────────────────────────
function EditProfileScreen({user,onBack,onSave,dark,setDark,T,showToast}){
  const[name,setName]=useState(user.name||"");
  const[course,setCourse]=useState(user.course||"");
  const[targetUni,setTargetUni]=useState(user.targetUniversity||"");
  const[subjects,setSubjects]=useState(user.subjects||[]);
  const[saving,setSaving]=useState(false);
  const[step,setStep]=useState(0); // 0=name+course, 1=university, 2=subjects

  const group=Object.entries(COURSE_GROUPS).find(([,g])=>g.courses.includes(course))?.[0]||"Sciences";
  const availableSubjects=COURSE_GROUPS[group]?.subjects||[];
  const requiredPoints=targetUni&&course?getRequiredPoints(targetUni,course):(user.requiredPoints||13);

  const profileEdits=user.profileEdits||0;
  const signedUpAt=user.createdAt?.toDate?.()||new Date(user.createdAt)||new Date();
  const hoursOld=(Date.now()-signedUpAt.getTime())/(1000*60*60);
  const isFree=profileEdits===0||hoursOld<24;

  const toggleSubject=s=>{
    if(subjects.includes(s))setSubjects(prev=>prev.filter(x=>x!==s));
    else if(subjects.length<3)setSubjects(prev=>[...prev,s]);
  };

  const canSave=name.trim()&&course&&targetUni&&subjects.length===3;

  const doSave=async()=>{
    if(!canSave)return;
    setSaving(true);
    try{
      const updates={
        name:name.trim(),course,group,
        subjects,targetUniversity:targetUni,
        targetPoints:requiredPoints,requiredPoints,
        profileEdits:increment(1),
        lastProfileEdit:new Date().toISOString()
      };
      await updateDoc(doc(db,"users",user.uid),updates);
      const updated={...user,...updates,profileEdits:profileEdits+1,name:name.trim(),course,group,subjects,targetUniversity:targetUni,targetPoints:requiredPoints,requiredPoints};
      onSave(updated);
      showToast("Profile updated ✓","success");
    }catch(e){showToast("Failed to save. Try again.","error");}
    finally{setSaving(false);}
  };

  const handleSaveWithPayment=async()=>{
    if(!canSave)return;
    if(isFree){doSave();return;}
    // Charge ₦500 for subsequent edits
    if(!window.PaystackPop){showToast("Loading payment…","info");return;}
    const key=import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
    if(!key){showToast("Payment not configured.","error");return;}
    const ref=`crediq_edit_${user.uid}_${Date.now()}`;
    const handler=window.PaystackPop.setup({
      key,email:user.email,amount:50000,currency:"NGN",ref,
      channels:["bank_transfer"],
      metadata:{uid:user.uid,type:"profile_edit"},
      onSuccess:async()=>{showToast("Payment confirmed! Saving changes…","info");await doSave();},
      onCancel:()=>{}
    });
    handler.openIframe();
  };

  return(
    <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,paddingBottom:100}}>
      {/* Header */}
      <div style={{background:T.navBg,padding:"20px 20px 16px",borderBottom:`1px solid ${T.navBorder}`}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",color:T.muted,padding:0}}>
            <ChevronLeft size={22} color={T.muted}/>
          </button>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:18,fontWeight:900,color:T.text}}>Edit Profile</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}60`,letterSpacing:"0.15em",marginTop:2}}>
              {isFree?"FREE EDIT":"₦500 TO SAVE CHANGES"}
            </div>
          </div>
        </div>
      </div>

      {!isFree&&(
        <div style={{margin:"16px 18px 0",padding:"12px 16px",background:"rgba(249,115,22,0.08)",border:"1px solid rgba(249,115,22,0.25)",borderRadius:10}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#f97316",letterSpacing:"0.1em",marginBottom:4}}>PROFILE EDIT — ₦500</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,lineHeight:1.7}}>You've already made a free edit. Additional changes cost ₦500 to prevent account sharing.</div>
        </div>
      )}

      <div style={{padding:"20px 18px",maxWidth:640,margin:"0 auto"}}>

        {/* Name */}
        <div style={{marginBottom:20}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:8}}>YOUR NAME</div>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Full name"
            style={{width:"100%",padding:"14px 16px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,fontFamily:"'DM Mono',monospace",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
        </div>

        {/* Course */}
        <div style={{marginBottom:20}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:8}}>TARGET COURSE</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {ALL_COURSES.map(c=>{
              const sel=course===c;
              return(
                <button key={c} onClick={()=>setCourse(c)}
                  style={{padding:"10px 12px",borderRadius:8,border:`1px solid ${sel?T.gold:T.border}`,background:sel?`${T.gold}15`:"transparent",color:sel?T.gold:T.muted,fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer",textAlign:"left",letterSpacing:"0.04em"}}>
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        {/* University */}
        <div style={{marginBottom:20}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:8}}>TARGET UNIVERSITY</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {UNIVERSITIES_DATA.filter(u=>u.acceptsJUPEB).slice(0,12).map(u=>{
              const sel=targetUni===u.shortName;
              return(
                <button key={u.shortName} onClick={()=>setTargetUni(u.shortName)}
                  style={{padding:"10px 12px",borderRadius:8,border:`1px solid ${sel?T.gold:T.border}`,background:sel?`${T.gold}15`:"transparent",color:sel?T.gold:T.muted,fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer",textAlign:"left"}}>
                  {u.shortName}
                </button>
              );
            })}
          </div>
        </div>

        {/* Subjects */}
        <div style={{marginBottom:28}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.14em",marginBottom:4}}>YOUR 3 SUBJECTS</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}55`,marginBottom:10}}>{subjects.length}/3 selected · based on your course group</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {availableSubjects.map(s=>{
              const sel=subjects.includes(s);
              const disabled=!sel&&subjects.length>=3;
              return(
                <button key={s} onClick={()=>!disabled&&toggleSubject(s)}
                  style={{padding:"10px 12px",borderRadius:8,border:`1px solid ${sel?"#4ade80":T.border}`,background:sel?"rgba(74,222,128,0.1)":"transparent",color:sel?"#4ade80":disabled?`${T.muted}40`:T.muted,fontFamily:"'DM Mono',monospace",fontSize:10,cursor:disabled?"not-allowed":"pointer",textAlign:"left"}}>
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {/* Save button */}
        <button onClick={handleSaveWithPayment} disabled={!canSave||saving}
          style={{width:"100%",minHeight:54,padding:"0 24px",border:"none",borderRadius:27,
            background:canSave?"linear-gradient(135deg,#004B3B,#8A6A1E)":"rgba(255,255,255,0.06)",
            color:canSave?"#F7F3EC":`${T.muted}60`,
            fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:700,
            cursor:canSave?"pointer":"not-allowed",
            boxShadow:canSave?"0 8px 28px rgba(0,75,59,0.4)":"none"}}>
          {saving?"Saving…":isFree?"Save Changes →":"Pay ₦500 & Save →"}
        </button>

        {!isFree&&(
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}45`,textAlign:"center",marginTop:12,lineHeight:1.8}}>
            Charged to prevent account sharing · Contact support if you need help
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
function ProfileScreen({user,streak,onBack,onLogout,onNav,dark,setDark,T,showToast,onVerifyPayment}) {
  const pendingRef=localStorage.getItem("cq_pending_ref");

  // Referral unlock tiers
  const refCount=user.referralCount||0;
  const UNLOCK_TIERS=[
    {min:3,label:"7 Days Premium",color:"#B8973E",desc:"3 friends joined"},
    {min:10,label:"Permanent Premium 🔥",color:"#4ade80",desc:"10 friends joined"},
  ];
  const nextTier=UNLOCK_TIERS.find(t=>refCount<t.min);
  const pct=nextTier?Math.min(100,(refCount/nextTier.min)*100):100;
  const referralLink=`https://credi-q.vercel.app/?ref=${user.referralCode||""}`;
  const copyLink=()=>{navigator.clipboard.writeText(referralLink).then(()=>showToast("Referral link copied! 🔥","success")).catch(()=>showToast("Copy failed","error"));};

  return (
    <div className="screen-enter" style={{minHeight:"100dvh",background:T.bg,color:T.text,paddingBottom:80}}>
      <div style={{background:T.navBg,padding:"20px 20px 16px",borderBottom:`1px solid ${T.navBorder}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><Logo size={18} onDark={true}/><div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.5)",letterSpacing:"0.15em",marginTop:4}}>PROFILE & SETTINGS</div></div>
          <ThemeBtn dark={dark} setDark={setDark} T={T}/>
        </div>
      </div>

      <div style={{padding:"18px",maxWidth:1000,margin:"0 auto",width:"100%"}}>

        {/* ── VERIFY PAYMENT BANNER ── */}
        {pendingRef&&!user?.isPremium&&(
          <div style={{background:"rgba(249,115,22,0.08)",border:"1px solid rgba(249,115,22,0.35)",borderRadius:12,padding:"14px 16px",marginBottom:16}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#f97316",letterSpacing:"0.12em",marginBottom:6}}>PAYMENT PENDING ACTIVATION</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginBottom:10,lineHeight:1.7}}>Your payment went through but premium wasn't activated automatically. Tap below to retry.</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}60`,marginBottom:10}}>Ref: {pendingRef}</div>
            <button onClick={()=>onVerifyPayment&&onVerifyPayment(pendingRef)}
              style={{width:"100%",padding:"12px",border:"none",borderRadius:8,background:"#f97316",color:"#fff",fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer",letterSpacing:"0.08em",fontWeight:700}}>
              Verify & Activate Premium →
            </button>
          </div>
        )}

        {/* ── USER CARD ── */}
        <div className="fi1" style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"20px 18px",marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:22,fontWeight:900,color:T.text,marginBottom:2}}>{user.name}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,marginBottom:6}}>{user.email}</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>{getFuture(user.course)} track · {(user.subjects||[]).join(", ")}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8,flexShrink:0,marginLeft:12}}>
              {user.isPremium?<div style={{background:"rgba(74,222,128,0.12)",border:"1px solid rgba(74,222,128,0.3)",borderRadius:20,padding:"4px 12px",fontFamily:"'DM Mono',monospace",fontSize:9,color:"#4ade80"}}>PREMIUM</div>:<div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>FREE</div>}
              <button onClick={()=>onNav("editprofile")} style={{padding:"7px 14px",border:`1px solid ${T.border}`,borderRadius:8,background:"transparent",color:T.muted,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer",letterSpacing:"0.06em"}}>Edit →</button>
            </div>
          </div>
          {streak.count>0&&(
            <div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:8}}>
              <Flame size={16} color={streak.count>=7?"#f97316":"#B8973E"}/>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:streak.count>=7?"#f97316":T.gold}}>{streak.count}-day study streak</span>
              {streak.studiedToday&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.success}}>✓ studied today</span>}
            </div>
          )}
        </div>

        {/* ── REFERRAL UNLOCK ── */}
        {!user.isPremium&&(
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"18px",marginBottom:20}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.gold,letterSpacing:"0.16em",marginBottom:12}}>🔥 EARN PREMIUM FREE</div>
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.text,fontWeight:700}}>{refCount} friend{refCount!==1?"s":""} joined</div>
                {nextTier&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.gold}}>{nextTier.min-refCount} more → {nextTier.label}</div>}
                {!nextTier&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"#4ade80"}}>All tiers unlocked 🎉</div>}
              </div>
              <div style={{height:6,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${T.gold},#4ade80)`,borderRadius:3,transition:"width 0.8s"}}/>
              </div>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              {UNLOCK_TIERS.map(tier=>{
                const done=refCount>=tier.min;
                return(
                  <div key={tier.min} style={{flex:1,padding:"10px 12px",borderRadius:8,border:`1px solid ${done?tier.color:T.border}`,background:done?`${tier.color}10`:"transparent"}}>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:done?tier.color:T.muted,letterSpacing:"0.1em",marginBottom:3}}>{done?"✓ UNLOCKED":"LOCKED"}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:done?tier.color:T.muted,fontWeight:700}}>{tier.desc}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:done?tier.color:`${T.muted}60`,marginTop:2}}>{tier.label}</div>
                  </div>
                );
              })}
            </div>
            <div style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 12px",marginBottom:10}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:`${T.muted}60`,marginBottom:4,letterSpacing:"0.1em"}}>YOUR REFERRAL LINK</div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.gold,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{referralLink}</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={copyLink} style={{flex:1,padding:"11px 0",border:`1px solid ${T.border}`,borderRadius:8,background:"transparent",color:T.muted,fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer"}}>Copy Link</button>
              <a href={`https://wa.me/?text=I've been using CrediQ to prepare for JUPEB and it's 🔥 Try it free: ${encodeURIComponent(referralLink)}`} target="_blank" rel="noopener noreferrer"
                style={{flex:2,padding:"11px 0",border:"none",borderRadius:8,background:"#25D366",color:"#fff",fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,cursor:"pointer",textDecoration:"none",display:"flex",alignItems:"center",justifyContent:"center"}}>
                Share on WhatsApp 💬
              </a>
            </div>
          </div>
        )}
        <div className="fi2" style={{marginBottom:20}}>
          {[
            {icon:<Calendar size={18} color={T.gold}/>,label:"JUPEB 2026 Timetable",sub:"Official exam schedule with countdowns",action:()=>onNav("timetable"),accent:T.gold},
            {icon:<Award size={18} color="#B8973E"/>,label:"Campus Ambassador",sub:`${user.referralCount||0} students referred · ${AMBASSADOR_TIERS.find(t=>(user.referralCount||0)>=t.min&&(user.referralCount||0)<=t.max)?.name||"Bronze"} tier`,action:()=>onNav("ambassador"),accent:"#B8973E"},
            {icon:<Zap size={18} color={T.success}/>,label:"Why Premium?",sub:"See what unlocks when you upgrade",action:()=>onNav("whypremium"),accent:T.success},
            ...(isFounder(user)?[{icon:<BarChart2 size={18} color={T.gold}/>,label:"Founder Dashboard",sub:"Live analytics · students · conversion · growth",action:()=>onNav("founder"),accent:T.gold}]:[]),
          ].map((item,i)=>(
            <div key={i} className="btn-press" onClick={item.action}
              style={{background:T.surface,border:`1px solid ${T.border}`,borderLeft:'none',
                borderRadius:10,padding:"16px 16px",marginBottom:8,cursor:"pointer",
                display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,flex:1}}>
                <div style={{width:36,height:36,borderRadius:8,background:`${item.accent}15`,
                  display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {item.icon}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,color:T.text,fontWeight:600,marginBottom:2}}>{item.label}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,lineHeight:1.4}}>{item.sub}</div>
                </div>
              </div>
              <ChevronRight size={16} color={T.muted} style={{flexShrink:0,marginLeft:8}}/>
            </div>
          ))}
        </div>

        {/* Support */}
        <div className="fi3" style={{marginBottom:20}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted,letterSpacing:"0.1em",marginBottom:10}}>SUPPORT</div>

          {/* WhatsApp */}
          <a href={WHATSAPP_LINK} target="_blank" rel="noopener noreferrer" style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(37,211,102,0.08)",border:"1px solid rgba(37,211,102,0.2)",borderRadius:10,padding:"14px 16px",textDecoration:"none",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <MessageCircle size={16} color="#25D366"/>
              <div>
                <div style={{fontSize:13,color:T.text,fontWeight:500}}>WhatsApp Support</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginTop:2}}>Chat with us directly — real humans</div>
              </div>
            </div>
            <ChevronRight size={14} color={T.muted}/>
          </a>

          {/* Privacy Policy */}
          <div className="btn-press" onClick={()=>window.open("https://credi-q.vercel.app/privacy.html","_blank")} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <Shield size={16} color={T.muted}/>
              <div>
                <div style={{fontSize:13,color:T.text,fontWeight:500}}>Privacy Policy</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginTop:2}}>How we handle your data</div>
              </div>
            </div>
            <ChevronRight size={14} color={T.muted}/>
          </div>

          {/* Terms of Service */}
          <div className="btn-press" onClick={()=>window.open("https://credi-q.vercel.app/terms.html","_blank")} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"14px 16px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <BookOpen size={16} color={T.muted}/>
              <div>
                <div style={{fontSize:13,color:T.text,fontWeight:500}}>Terms of Service</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginTop:2}}>Rules and payment policy</div>
              </div>
            </div>
            <ChevronRight size={14} color={T.muted}/>
          </div>
        </div>

        {/* Referral code display */}
        <div className="fi4" style={{background:"rgba(184,151,62,0.07)",border:"1px solid rgba(184,151,62,0.2)",borderRadius:9,padding:"14px 16px",marginBottom:20}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.gold,letterSpacing:"0.12em",marginBottom:8}}>YOUR REFERRAL CODE</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:24,fontWeight:900,color:T.gold}}>{user.referralCode||"CQ"+user.uid?.slice(0,6).toUpperCase()}</div>
            <button className="btn-press" onClick={()=>{navigator.clipboard?.writeText(user.referralCode);showToast&&showToast("Referral code copied!","success");}} style={{background:"rgba(184,151,62,0.15)",border:"1px solid rgba(184,151,62,0.3)",borderRadius:7,padding:"8px 12px",color:T.gold,fontFamily:"'DM Mono',monospace",fontSize:9,cursor:"pointer"}}>COPY</button>
          </div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted,marginTop:8}}>Share this with JUPEB students. Every signup builds your ambassador rank.</div>
        </div>

        {/* Logout */}
        <button className="btn-press" onClick={onLogout} style={{width:"100%",padding:"12px 0",border:`1px solid ${T.border}`,borderRadius:10,background:"transparent",color:T.muted,fontFamily:"'DM Mono',monospace",fontSize:10,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,letterSpacing:"0.08em"}}>
          <LogOut size={14}/> LOG OUT
        </button>
      </div>
    </div>
  );
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
// ─── PWA INSTALL BANNER ───────────────────────────────────────────────────────
// Why this exists: Chrome only fires `beforeinstallprompt` once the site has a
// linked manifest + an active service worker — see /public/manifest.json and
// /public/sw.js. iOS Safari never fires that event at all, so it gets its own
// instructional banner. Both re-surface on a cooldown instead of disappearing
// forever on first dismiss, per the "keep nudging until installed" requirement.
const PWA_DISMISS_COOLDOWN_MS=3*24*60*60*1000; // 3 days

function isStandaloneInstalled(){
  if(typeof window==="undefined")return false;
  if(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)return true;
  if(window.navigator.standalone===true)return true; // legacy iOS Safari flag
  return localStorage.getItem("cq_pwa_installed")==="1";
}

// ─── INSTALL BUTTON ────────────────────────────────────────────────────────
// A small, always-visible, manually-tappable alternative to the banner —
// doesn't wait for Chrome's own timing to decide to show anything. Vanishes
// the moment isStandaloneInstalled() is true, exactly once installed.
function InstallButton({T}){
  const[prompt,setPrompt]=useState(null);
  const[isInstalled,setIsInstalled]=useState(()=>isStandaloneInstalled());
  const[hint,setHint]=useState(null); // null | "ios" | "manual"
  const isIOS=useMemo(()=>/iphone|ipad|ipod/i.test(navigator.userAgent)&&!window.MSStream,[]);

  useEffect(()=>{
    if(isInstalled)return;
    const handler=e=>{e.preventDefault();setPrompt(e);};
    const onInstalled=()=>{localStorage.setItem("cq_pwa_installed","1");setIsInstalled(true);};
    window.addEventListener("beforeinstallprompt",handler);
    window.addEventListener("appinstalled",onInstalled);
    return()=>{window.removeEventListener("beforeinstallprompt",handler);window.removeEventListener("appinstalled",onInstalled);};
  },[isInstalled]);

  if(isInstalled)return null;

  const handleTap=async()=>{
    if(prompt){
      prompt.prompt();
      const{outcome}=await prompt.userChoice;
      if(outcome==="accepted"){localStorage.setItem("cq_pwa_installed","1");setIsInstalled(true);}
      setPrompt(null);
    }else if(isIOS){
      setHint("ios");
    }else{
      setHint("manual");
    }
  };

  return(
    <>
      <button onClick={handleTap} style={{display:"flex",alignItems:"center",gap:5,background:"rgba(184,151,62,0.12)",border:`1px solid rgba(184,151,62,0.35)`,borderRadius:20,padding:"6px 12px",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,color:T.gold,letterSpacing:"0.04em",whiteSpace:"nowrap"}}>
        📲 INSTALL
      </button>
      {hint&&(
        <div onClick={()=>setHint(null)} style={{position:"fixed",inset:0,zIndex:600,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:420,background:"#0a1410",border:"1px solid rgba(184,151,62,0.3)",borderRadius:"18px 18px 0 0",padding:"22px 20px 28px"}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:16,fontWeight:700,color:"#F7F3EC",marginBottom:10}}>
              {hint==="ios"?"Add CrediQ to your Home Screen":"Install CrediQ"}
            </div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(247,243,236,0.65)",lineHeight:1.8}}>
              {hint==="ios"
                ?"Tap the Share icon in your browser's toolbar, then choose \"Add to Home Screen.\""
                :"Open your browser's menu (usually ⋮ in the top corner), then choose \"Install app\" or \"Add to Home Screen.\""}
            </div>
            <button onClick={()=>setHint(null)} style={{marginTop:18,width:"100%",padding:"12px 0",border:"1px solid rgba(184,151,62,0.3)",borderRadius:10,background:"transparent",color:T.gold,fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,cursor:"pointer"}}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function PWABanner({T}){
  const[prompt,setPrompt]=useState(null);
  const[justInstalled,setJustInstalled]=useState(false);
  const[isInstalled,setIsInstalled]=useState(()=>isStandaloneInstalled());
  const[visible,setVisible]=useState(()=>{
    const last=Number(localStorage.getItem("cq_pwa_last_dismissed")||0);
    return Date.now()-last>PWA_DISMISS_COOLDOWN_MS;
  });
  const isIOS=useMemo(()=>/iphone|ipad|ipod/i.test(navigator.userAgent)&&!window.MSStream,[]);

  useEffect(()=>{
    if(isInstalled)return;
    const handler=e=>{e.preventDefault();setPrompt(e);};
    const onInstalled=()=>{
      localStorage.setItem("cq_pwa_installed","1");
      setIsInstalled(true);setJustInstalled(true);
      setTimeout(()=>setJustInstalled(false),5000);
    };
    window.addEventListener("beforeinstallprompt",handler);
    window.addEventListener("appinstalled",onInstalled);
    return()=>{window.removeEventListener("beforeinstallprompt",handler);window.removeEventListener("appinstalled",onInstalled);};
  },[isInstalled]);

  if(isInstalled&&!justInstalled)return null;
  if(!visible&&!justInstalled)return null;
  if(!justInstalled&&!isIOS&&!prompt)return null; // Android/desktop: wait for the real browser event

  if(justInstalled){
    return(
      <div style={{position:"fixed",bottom:72,left:12,right:12,zIndex:490,background:"linear-gradient(135deg,#0f2218,#1B3A2A)",border:"1px solid rgba(74,222,128,0.4)",borderRadius:14,padding:"14px 18px",display:"flex",alignItems:"center",gap:12,boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
        <div style={{fontSize:22}}>🎉</div>
        <div>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:"#4ade80"}}>CrediQ is now on your phone</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(247,243,236,0.5)",marginTop:2,letterSpacing:"0.08em"}}>TAP THE ICON ON YOUR HOME SCREEN TO OPEN</div>
        </div>
      </div>
    );
  }

  const handleDismiss=()=>{setVisible(false);localStorage.setItem("cq_pwa_last_dismissed",String(Date.now()));};

  if(isIOS){
    return(
      <div style={{position:"fixed",bottom:72,left:12,right:12,zIndex:490,background:"linear-gradient(135deg,#0a1410,#0f2218)",border:"1px solid rgba(184,151,62,0.35)",borderRadius:14,padding:"14px 18px",display:"flex",alignItems:"center",gap:14,boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
        <div style={{fontSize:26,flexShrink:0}}>📱</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:"#F7F3EC"}}>Add CrediQ to your Home Screen</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.7)",marginTop:2,letterSpacing:"0.06em"}}>TAP THE SHARE ICON BELOW, THEN "ADD TO HOME SCREEN"</div>
        </div>
        <button onClick={handleDismiss} style={{flexShrink:0,background:"none",border:"none",cursor:"pointer",color:"rgba(247,243,236,0.3)",padding:4,lineHeight:1}}>✕</button>
      </div>
    );
  }

  const handleInstall=async()=>{
    if(!prompt)return;
    prompt.prompt();
    const{outcome}=await prompt.userChoice;
    setPrompt(null);
    if(outcome==="accepted"){
      localStorage.setItem("cq_pwa_installed","1");
      setIsInstalled(true);setJustInstalled(true);
      setTimeout(()=>setJustInstalled(false),5000);
    }else{
      handleDismiss(); // declined — respect cooldown instead of re-asking immediately
    }
  };

  return(
    <div style={{position:"fixed",bottom:72,left:12,right:12,zIndex:490,background:"linear-gradient(135deg,#0a1410,#0f2218)",border:"1px solid rgba(184,151,62,0.35)",borderRadius:14,padding:"14px 18px",display:"flex",alignItems:"center",gap:14,boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>
      <div style={{fontSize:26,flexShrink:0}}>📱</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontFamily:"'Playfair Display',serif",fontSize:15,fontWeight:700,color:"#F7F3EC"}}>Install CrediQ</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:"rgba(184,151,62,0.7)",marginTop:2,letterSpacing:"0.06em"}}>ACCESS YOUR JUPEB DASHBOARD FASTER</div>
      </div>
      <button onClick={handleInstall} style={{flexShrink:0,padding:"9px 18px",background:"linear-gradient(135deg,#B8973E,#D4AE5A)",border:"none",borderRadius:8,color:"#0a1410",fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,cursor:"pointer",letterSpacing:"0.08em"}}>INSTALL</button>
      <button onClick={handleDismiss} style={{flexShrink:0,background:"none",border:"none",cursor:"pointer",color:"rgba(247,243,236,0.3)",padding:4,lineHeight:1}}>✕</button>
    </div>
  );
}

export default function App() {
  // INSTANT: read from cache synchronously (0ms) — no Firebase wait for returning users
  const cachedUser=useMemo(()=>UserCache.get(),[]);
  const [screen,setScreen]=useState(()=>cachedUser?(cachedUser.onboarded?"dashboard":"onboard"):"loading");
  const [user,setUser]=useState(cachedUser);
  const [history,setHistory]=useState([]);
  const [QB,setQB]=useState({});
  const [dark,setDark]=useState(true);
  const [examConfig,setExamConfig]=useState(null);
  const [examResult,setExamResult]=useState(null);
  const [showPremiumGate,setShowPremiumGate]=useState(false);
  const [showSessionMismatch,setShowSessionMismatch]=useState(false);

  // ── SESSION POLL: every 30s check if another device stole the session ──
  useEffect(()=>{
    if(!user?.uid)return;
    const check=async()=>{
      try{
        const snap=await getDoc(doc(db,"users",user.uid));
        if(!snap.exists())return;
        const firestoreToken=snap.data().activeSession;
        const localToken=Session.get();
        if(firestoreToken&&localToken&&firestoreToken!==localToken){
          setShowSessionMismatch(true);
        }
      }catch{}
    };
    const interval=setInterval(check,30000);
    return()=>clearInterval(interval);
  },[user?.uid]);
  const [historyLoaded,setHistoryLoaded]=useState(true);
  const [streak,setStreak]=useState({count:0,studiedToday:false});
  const {toasts,show}=useToast();
  const T=dark?DARK:LIGHT;
  const userDocUnsub=useRef(null);

  // Real-time listener on user doc — picks up webhook-driven isPremium changes instantly
  const attachUserListener=uid=>{
    if(userDocUnsub.current)userDocUnsub.current(); // clear any existing listener
    userDocUnsub.current=onSnapshot(doc(db,'users',uid),snap=>{
      if(!snap.exists())return;
      const fresh={uid,...snap.data()};
      setUser(prev=>{
        // Only update if something actually changed (avoids unnecessary re-renders)
        if(prev?.isPremium===fresh.isPremium&&prev?.premiumExpiry===fresh.premiumExpiry)return prev;
        UserCache.set(fresh);
        if(!prev?.isPremium&&fresh.isPremium){
          // Webhook just activated premium — close gate if open, show toast
          setShowPremiumGate(false);
          show("🎉 Premium activated! Full access unlocked.","success");
        }
        return fresh;
      });
    },()=>{}); // silently ignore listener errors (offline etc)
  };

  // Capture referral code from URL on load (?ref=CODE)
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const ref=params.get("ref");
    if(ref)localStorage.setItem("cq_ref",ref.trim().toUpperCase());
  },[]);

  // Load streak on mount
  useEffect(()=>setStreak(Streak.get()),[]);

  // Inject Paystack inline JS — must load before payment button is tapped
  useEffect(()=>{
    if(window.PaystackPop)return;
    const s=document.createElement("script");
    s.src="https://js.paystack.co/v1/inline.js";
    s.async=true;
    s.onerror=()=>console.error("[CrediQ] Paystack failed to load");
    document.head.appendChild(s);
  },[]);

  const loadHistory=async uid=>{
    setHistoryLoaded(false);
    try{
      const q=query(collection(db,"sessions"),where("userId","==",uid),limit(100));
      const snap=await getDocs(q);
      const sessions=snap.docs.map(d=>d.data()).sort((a,b)=>{
        const at=a.createdAt?.toDate?.()?.getTime()||new Date(a.date).getTime();
        const bt=b.createdAt?.toDate?.()?.getTime()||new Date(b.date).getTime();
        return at-bt;
      });
      setHistory(sessions);

      // Fix 4: sync any sessions that failed to save last time (offline recovery)
      const pending=PendingSessions.getAll().filter(p=>p.uid===uid);
      if(pending.length){
        for(const p of pending){
          try{
            await saveSession(uid,p.data);
            PendingSessions.remove(p.id);
          }catch(e){console.warn("Pending sync failed — will retry next load:",e);}
        }
        if(pending.length){
          // Re-fetch history to include newly synced sessions
          const q2=query(collection(db,"sessions"),where("userId","==",uid),limit(100));
          const snap2=await getDocs(q2);
          const sessions2=snap2.docs.map(d=>d.data()).sort((a,b)=>{
            const at=a.createdAt?.toDate?.()?.getTime()||new Date(a.date).getTime();
            const bt=b.createdAt?.toDate?.()?.getTime()||new Date(b.date).getTime();
            return at-bt;
          });
          setHistory(sessions2);
        }
      }
    }catch(e){console.error("Load history:",e);}
    finally{setHistoryLoaded(true);}
  };

  // Auth state
  useEffect(()=>{
    // Safety timeout — never stay on loading screen more than 6 seconds
    const safetyTimer=setTimeout(()=>setScreen(s=>s==="loading"?"landing":s),6000);
    const unsub=onAuthStateChanged(auth,async fbUser=>{
      clearTimeout(safetyTimer);
      if(fbUser){
        try{
          const userData=await getUserDoc(fbUser.uid);
          if(userData){
            // If brand new unverified user — let signup flow (pendingVerify) handle it
            if(!fbUser.emailVerified && !userData.onboarded){
              setScreen(s=>s==="loading"?"landing":s);return;
            }
            // Existing/returning user — let them in
            const fullUser={uid:fbUser.uid,...userData};
            setUser(fullUser);
            UserCache.set(fullUser);
            localStorage.setItem("cq_current_uid",fbUser.uid);
            setScreen(userData.onboarded?"dashboard":"onboard");
            loadHistory(fbUser.uid);
            attachUserListener(fbUser.uid);
          }else if(!fbUser.emailVerified){
            // No user doc + unverified — brand new, let signup flow handle it
            setScreen(s=>s==="loading"?"landing":s);return;
          }else{UserCache.clear();setScreen("landing");}
        }catch{
          // Network error — keep showing cached screen, don't kick user out
          if(!cachedUser)setScreen("landing");
        }
      }else{UserCache.clear();localStorage.removeItem("cq_current_uid");setUser(null);setHistory([]);setQB({});setScreen("landing");if(userDocUnsub.current){userDocUnsub.current();userDocUnsub.current=null;}}
    });
    return ()=>{clearTimeout(safetyTimer);unsub();};
  },[]);


  // LAZY LOADING — questions only load when Practice is tapped
  const loadQuestions=async subjects=>{
    if(!subjects?.length)return;
    try{
      const qb={};
      for(const subject of subjects){
        // Check IndexedDB cache first
        const cached=await IDB.get(`questions_${subject}`);
        if(cached){qb[subject]=cached;continue;}
        // Fetch from Firestore
        const q=query(collection(db,"questions"),where("subject","==",subject),where("isValid","==",true));
        const snap=await getDocs(q);
        const byYear={};
        snap.docs.forEach(d=>{
          const data=d.data();const year=String(data.year);
          if(!byYear[year])byYear[year]=[];
          byYear[year].push(data);
        });
        qb[subject]=byYear;
        // Cache in IndexedDB
        await IDB.set(`questions_${subject}`,byYear);
      }
      setQB(qb);
      show("Questions loaded — you're ready.","success");
    }catch(e){
      console.error("Load questions:",e);
      show("Couldn't load questions. Check your internet.","error");
    }
  };

  const handleAuth=userData=>{
    localStorage.setItem("cq_current_uid",userData.uid||"anon");
    setUser(userData);
    setScreen(userData.onboarded?"dashboard":"onboard");
    requestNotifPermission(userData);
    // ── SESSION LOCK: save token to Firestore so other devices get kicked ──
    const token=Session.generate();
    updateDoc(doc(db,"users",userData.uid),{activeSession:token}).catch(()=>{});
  };

  const [onboardComplete,setOnboardComplete]=useState(false);

  const handleOnboard=async updatedUser=>{
    setUser(updatedUser);
    UserCache.set(updatedUser);
    setOnboardComplete(true);
    setTimeout(()=>{setOnboardComplete(false);setScreen("dashboard");},2200);
  };

  const handleExamEnd=async result=>{
    // Capture readiness BEFORE this session so we can show the delta
    const preReadiness=Math.round(calcReadiness(history)||0);
    const newHist=[...history,result];
    const postReadiness=Math.round(calcReadiness(newHist)||0);
    setHistory(newHist);
    setExamResult({...result,preReadiness,postReadiness});
    const newStreak=Streak.bump();setStreak({count:newStreak,studiedToday:true});
    // Sync streak to Firestore so it persists across devices
    if(user?.uid){
      updateDoc(doc(db,"users",user.uid),{streak:newStreak,lastSessionDate:new Date().toISOString().split("T")[0]}).catch(()=>{});
    }
    if(user?.uid){
      try{
        const timeOfDay=getTimeOfDay();
        const dayOfWeek=getDayOfWeek();
        const daysToExam=getDaysToExam();
        const qResults=result.questionResults||[];

        // Detect course unit from first wrong topic
        const courseUnit=getCourseUnit(result.subject,result.wrongTopics?.[0]||"");

        // Per-question timing averages
        const wrongQ=qResults.filter(q=>!q.correct);
        const rightQ=qResults.filter(q=>q.correct);
        const avgTimeWrong=wrongQ.length&&wrongQ.some(q=>q.timeSpent)?Math.round(wrongQ.reduce((s,q)=>s+(q.timeSpent||0),0)/wrongQ.length):0;
        const avgTimeRight=rightQ.length&&rightQ.some(q=>q.timeSpent)?Math.round(rightQ.reduce((s,q)=>s+(q.timeSpent||0),0)/rightQ.length):0;

        // Fix 3a: back up session to localStorage BEFORE any Firestore writes
        // If network fails, data survives and can be resynced
        const sessionPayload={
          subject:result.subject,year:result.year,mode:result.mode,
          score:result.correct,total:result.total,pct:result.pct,grade:result.grade,
          wrongTopics:result.wrongTopics||[],questionResults:qResults,
          duration:result.duration,date:result.date,isDrill:result.mode==="Drill",abandoned:false,
          courseUnit,daysToExam,timeOfDay,dayOfWeek,
          completionRate:100,
          averageTimeOnWrongAnswers:avgTimeWrong,
          averageTimeOnCorrectAnswers:avgTimeRight,
          timePerQuestion:qResults.map(q=>q.timeSpent||0),
          answerChanges:result.answerChanges||[],
          abandonedAtQuestion:null,
          // Phase 5 seeds: store target data for future competition ranking
          targetUniversity:user.targetUniversity||"",
          targetCourse:user.course||"",
        };
        const backupId=Date.now();
        PendingSessions.push(user.uid,{...sessionPayload,backupId});

        // 1. Save enhanced session to Firestore
        await saveSession(user.uid,sessionPayload);

        // Fix 3b: Firestore write succeeded — clear the localStorage backup
        PendingSessions.remove(backupId);

        // Phase 5 seed: daily session aggregate — makes community counter real over time
        const todayStr=new Date().toISOString().split("T")[0];
        setDoc(doc(db,"dailyStats",todayStr),{sessions:increment(1),lastUpdated:todayStr},{merge:true}).catch(()=>{});

        // 2. Daily question count
        if(!user.isPremium){
          const newQToday=(user.questionsToday||0)+result.total;
          const today=new Date().toDateString();
          await updateDoc(doc(db,"users",user.uid),{questionsToday:increment(result.total),lastActiveDate:today});
          const updatedUser={...user,questionsToday:newQToday,lastActiveDate:today};
          setUser(updatedUser);
          UserCache.set(updatedUser);
        }

        // 3. Weak topics
        const allWeak=calcWeakTopics(newHist);

        // 4. Grade history (rolling last 10)
        const prevGradeHistory=user.gradeHistory||[];
        const newGradeHistory=[...prevGradeHistory,result.grade].slice(-10);
        const avgGrade=numToGrade(Math.round(newGradeHistory.reduce((s,g)=>s+gradeToNum(g),0)/newGradeHistory.length));

        // 5. Strong topics from mastery (topics >70% correct in this session)
        const strongFromSession=qResults.reduce((acc,q)=>{
          if(q.correct&&q.topic&&!acc.includes(q.topic))acc.push(q.topic);
          return acc;
        },[]).slice(0,10);

        // 6. Update user doc
        const subjectAvgMap={};
        newHist.filter(isRealSession).forEach(h=>{
          if(!subjectAvgMap[h.subject])subjectAvgMap[h.subject]={total:0,count:0};
          subjectAvgMap[h.subject].total+=h.pct;
          subjectAvgMap[h.subject].count+=1;
        });
        const subs=user.subjects||[];
        let estPts=subs.reduce((sum,sub)=>{
          const d=subjectAvgMap[sub];
          if(!d)return sum;
          return sum+jupebGrade(Math.round(d.total/d.count)).points;
        },0);
        const hasAllSubs=subs.every(s=>subjectAvgMap[s]);
        const noFails=hasAllSubs&&!subs.some(s=>{const d=subjectAvgMap[s];return!d||jupebGrade(Math.round(d.total/d.count)).grade==="F";});
        if(noFails)estPts+=1;
        await updateDoc(doc(db,"users",user.uid),{
          weakTopics:allWeak,
          gradeHistory:newGradeHistory,
          averageGrade:avgGrade,
          totalSessionsCompleted:increment(1),
          studyPattern:timeOfDay,
          consistencyScore:Math.min(100,Math.round((newStreak/30)*100)),
          lastSessionDate:new Date().toISOString().split("T")[0],
          strongTopics:strongFromSession,
        });
        // currentPoints is separate — rules are stricter on the main update
        updateDoc(doc(db,"users",user.uid),{currentPoints:estPts}).catch(()=>{});
        setUser(u=>({...u,weakTopics:allWeak,gradeHistory:newGradeHistory,averageGrade:avgGrade}));

        // 7. Mastery subcollection (non-blocking)
        if(qResults.length){
          updateMastery(user.uid,qResults).catch(e=>console.warn("Mastery update:",e));
        }

        // 8. Engagement collection (non-blocking)
        updateEngagement(user.uid,{timeOfDay,dayOfWeek,streakCount:newStreak}).catch(e=>console.warn("Engagement update:",e));

        // 9. Readiness collection (non-blocking)
        updateReadiness(user.uid,newHist,user.subjects||[]).catch(e=>console.warn("Readiness update:",e));

        // 10. First session email disabled — re-enable after domain setup

      }catch(e){
        console.error("Save session:",e);
        // Fix 3c: backup already in localStorage — tell user clearly, don't panic them
        show("Your result is saved. We'll sync it when your connection is back.","info");
      }
    }
    setScreen("results");
  };

  const handleStartExam=async cfg=>{
    // No daily limit gate — free users can always do a full diagnostic (mock exam)
    // The only premium gate is drills (handled in DrillScreen/handleNav)
    if(!Object.keys(QB).length&&user?.subjects){
      await loadQuestions(user.subjects);
    }
    setExamConfig(cfg);setScreen("exam");
  };

  // ── Layer 1: API verifies Paystack ref (secret key stays safe server-side)
  //            then client writes to Firestore (already authenticated) ─────────
  const verifyAndActivatePremium=async(reference)=>{
    if(!reference||reference==="unknown"||reference==="null"){
      return{success:false,error:"no-ref"};
    }
    let paymentVerified=false;

    // Try server-side Paystack verification first
    try{
      const res=await fetch("/api/verify-payment",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({reference})
      });
      const data=await res.json();
      if(data.success)paymentVerified=true;
    }catch(e){
      console.warn("API verify failed — falling back to direct write:",e);
      // If our API is down, trust the reference and write directly
      // (Paystack already confirmed payment via their popup callback)
      paymentVerified=true;
    }

    if(!paymentVerified)return{success:false,error:"payment-not-confirmed"};

    // Write premium to Firestore — setDoc+merge works even if doc has issues
    try{
      const expiry=new Date("2026-08-03").toISOString();
      await setDoc(doc(db,"users",user.uid),{
        isPremium:true,
        premiumExpiry:expiry,
        paystackRef:reference,
        paidAt:Date.now()
      },{merge:true});
      return{success:true};
    }catch(e){
      console.error("Firestore write failed:",e);
      return{success:false,error:"firestore-failed"};
    }
  };

  // ── Layer 3: manual verify from Profile screen ─────────────────────────────
  const handleManualVerify=async(reference)=>{
    if(!reference||reference==="unknown"){
      show("No payment reference found. Contact support on WhatsApp.","error");
      return;
    }
    show("Verifying payment…","info");
    const result=await verifyAndActivatePremium(reference);
    if(result.success){
      try{
        const freshSnap=await getDoc(doc(db,"users",user.uid));
        const freshUser=freshSnap.exists()?{uid:user.uid,...freshSnap.data()}:{...user,isPremium:true};
        setUser(freshUser);UserCache.set(freshUser);
      }catch{setUser(u=>({...u,isPremium:true}));}
      localStorage.removeItem("cq_pending_ref");
      show("🎉 Premium activated! Full access unlocked.","success");
    }else if(result.error==="payment-not-confirmed"){
      show("Payment couldn't be confirmed with Paystack. Send your receipt to support on WhatsApp.","error");
    }else{
      show("Activation failed. Send this ref to support: "+reference,"error");
    }
  };

  const handleUpgradeToPremium=async()=>{
    if(!user)return;
    if(!window.PaystackPop){
      show("Loading payment…","info");
      let ms=0;
      await new Promise(res=>{const t=setInterval(()=>{ms+=200;if(window.PaystackPop||ms>=5000){clearInterval(t);res();}},200);});
      if(!window.PaystackPop){show("Payment could not load. Check your internet and try again.","error");return;}
    }
    const key=import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
    if(!key){show("Payment not configured. Contact support.","error");return;}
    // Generate ref BEFORE popup opens — if user switches to PalmPay/bank app,
    // the browser loses the onSuccess callback. Saving ref now means we can
    // always restore premium from Profile screen.
    const ref=`crediq_${user.uid}_${Date.now()}`;
    localStorage.setItem("cq_pending_ref",ref);
    const handler=window.PaystackPop.setup({
      key,
      email:user.email,
      amount:250000,
      currency:"NGN",
      ref,
      channels:["bank_transfer"],
      // uid in both places so webhook can always find it
      metadata:{uid:user.uid,custom_fields:[{display_name:"UID",variable_name:"uid",value:user.uid}]},
      onSuccess:async(transaction)=>{
        show("Payment confirmed! Activating your access…","info");
        const result=await verifyAndActivatePremium(transaction.reference);
        if(result.success){
          // ── AMBASSADOR COMMISSION (first-touch, one-time only) ──
          if(user.referredBy && !user.referralCredited){
            try{
              // Update legacy referrals doc
              const refSnap=await getDoc(doc(db,"referrals",user.referredBy));
              if(refSnap.exists()){
                const existing=refSnap.data().signupsList||[];
                const updated=existing.map(s=>s.uid===user.uid?{...s,isPaid:true,paidAt:new Date().toISOString()}:s);
                await updateDoc(doc(db,"referrals",user.referredBy),{conversions:increment(1),earnings:increment(AMBASSADOR_COMMISSION),signupsList:updated});
              }
              // Update ambassadors collection
              await setDoc(doc(db,"ambassadors",user.referredBy.toUpperCase()),{
                code:user.referredBy.toUpperCase(),
                premiumReferrals:increment(1),
                earnings:increment(AMBASSADOR_COMMISSION),
                lastConversion:new Date().toISOString(),
              },{merge:true});
              // Mark user as credited — prevents double commission even if payment fires twice
              await updateDoc(doc(db,"users",user.uid),{referralCredited:true});
            }catch(e){console.error("Ambassador commission error:",e);}
          }
          try{
            const freshSnap=await getDoc(doc(db,"users",user.uid));
            const freshUser=freshSnap.exists()?{uid:user.uid,...freshSnap.data()}:{...user,isPremium:true};
            setUser(freshUser);UserCache.set(freshUser);
          }catch{setUser(u=>({...u,isPremium:true}));}
          setShowPremiumGate(false);
          show("🎉 Welcome to CrediQ Premium! Full access unlocked.","success");
        }else{
          // Store ref so user can retry from Profile screen
          localStorage.setItem("cq_pending_ref",transaction.reference);
          show(`Payment received but activation hit a snag. Go to Profile → tap "Verify Payment". Ref: ${transaction.reference}`,"error");
        }
      },
      onCancel:()=>{}
    });
    handler.openIframe();
  };

  const handleLogout=async()=>{
    try{await signOut(auth);}catch{}
    Session.clear();UserCache.clear();setUser(null);setHistory([]);setQB({});setScreen("auth");
  };

  const handleNav=s=>{
    // Gate drill behind premium
    if(s==="drill"&&!user?.isPremium){setShowPremiumGate(true);return;}
    if(s==="editprofile"){setScreen("editprofile");return;}
    // Lazy load questions when Practice or Drill is tapped
    if((s==="setup"||s==="drill")&&!Object.keys(QB).length&&user?.subjects){
      loadQuestions(user.subjects);
    }
    setScreen(s);
  };

  const css=useMemo(()=>buildCSS(T),[dark]); // only recompute when dark/light switches
  // Sidebar shows on all authenticated screens except exam (focused) and public screens
  const showSidebar=!!user&&!["landing","auth","onboard","loading","exam"].includes(screen);
  const isMain=["dashboard","analytics","drill","profile"].includes(screen);
  const navChange=s=>{if(s==="setup")handleNav("setup");else handleNav(s);};

  if(screen==="loading")return <><style>{css}</style><LoadingScreen/></>;

  return (
    <>
      <style>{css}</style>
      <OfflineBanner/>
      <ToastContainer toasts={toasts}/>
      {user&&isMain&&<PWABanner T={T}/>}
      <div id="paystack-container" style={{position:"fixed",zIndex:99999,top:0,left:0,width:"100%",height:"100%",pointerEvents:"none"}}/>

      {showPremiumGate&&user&&<PremiumGate user={user} onClose={()=>setShowPremiumGate(false)} onGoToWhyPremium={()=>{setShowPremiumGate(false);setScreen("whypremium");}} onUpgrade={handleUpgradeToPremium} onRestore={()=>handleManualVerify(localStorage.getItem("cq_pending_ref"))} T={T}/>}

      {/* ── ONBOARD COMPLETE TRANSITION ── */}
      {onboardComplete&&(
        <div style={{position:"fixed",inset:0,background:"#040D07",zIndex:600,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20}}>
          <Logo size={32} onDark={true}/>
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:26,fontWeight:900,color:"#F7F3EC",marginBottom:8}}>Your mission is set.</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"rgba(184,151,62,0.7)",letterSpacing:"0.2em"}}>TIME TO GET TO WORK.</div>
          </div>
        </div>
      )}
      {showSessionMismatch&&<SessionMismatchModal onContinue={()=>{
        const token=Session.generate();
        if(user?.uid)updateDoc(doc(db,"users",user.uid),{activeSession:token}).catch(()=>{});
        setShowSessionMismatch(false);
      }} onLogout={handleLogout} T={T}/>}

      {/* Desktop sidebar — all authenticated non-exam screens */}
      {showSidebar&&<SideNav active={screen} onChange={navChange} user={user} dark={dark} setDark={setDark} T={T} onUpgrade={()=>setShowPremiumGate(true)} onLogout={handleLogout} onProfile={()=>setScreen("profile")}/>}

      {/* Main content — always fills available width */}
      <div className={showSidebar?"cq-main":""} style={{flex:1,width:"100%",minWidth:0}}>
        <div className="cq-content-wrap" style={{background:T.bg,minHeight:"100dvh"}}>

          {screen==="landing"&&<LandingScreen onGetStarted={()=>setScreen("auth")} onLogin={()=>setScreen("auth")} T={T}/>}
          {screen==="auth"&&<AuthScreen onAuth={handleAuth} dark={dark} setDark={setDark} T={T} hideTheme={showSidebar}/>}
          {screen==="onboard"&&user&&<OnboardScreen user={user} onDone={handleOnboard} dark={dark} setDark={setDark} T={T} hideTheme={showSidebar}/>}

          {screen==="dashboard"&&user&&(
            !historyLoaded?<DashboardSkeleton T={T}/>:
            <DashboardScreen user={user} history={history} historyLoaded={historyLoaded} QB={QB} onNav={handleNav} onLogout={handleLogout} dark={dark} setDark={setDark} T={T} showToast={show} streak={streak} onUpgrade={()=>setShowPremiumGate(true)}/>
          )}

          {screen==="analytics"&&user&&<AnalyticsScreen user={user} history={history} dark={dark} setDark={setDark} T={T} onUpgrade={()=>setShowPremiumGate(true)} onNav={handleNav}/>}
          {screen==="setup"&&user&&<SetupScreen user={user} QB={QB} onStart={handleStartExam} onBack={()=>setScreen("dashboard")} onRetryLoad={()=>loadQuestions(user.subjects)} dark={dark} setDark={setDark} T={T}/>}
          {screen==="drill"&&user&&<DrillScreen user={user} history={history} QB={QB} onEnd={handleExamEnd} onBack={()=>setScreen("dashboard")} dark={dark} setDark={setDark} T={T} showToast={show}/>}
          {screen==="exam"&&examConfig&&user&&<ExamScreen config={examConfig} user={user} onEnd={handleExamEnd} onQuit={()=>setScreen("dashboard")} onLimitHit={async partialResult=>{if(partialResult){await handleExamEnd(partialResult);}else{setScreen("dashboard");}}} dark={dark} setDark={setDark} T={T}/>}
          {screen==="results"&&examResult&&<ResultsScreen result={examResult} user={user} history={history} onHome={()=>setScreen("dashboard")} onRetry={()=>setScreen("setup")} onDrill={()=>setScreen("drill")} dark={dark} setDark={setDark} T={T}/>}
          {screen==="timetable"&&user&&<TimetableScreen user={user} onBack={()=>setScreen("profile")} T={T}/>}
          {screen==="ambassador"&&user&&<AmbassadorScreen user={user} onBack={()=>setScreen("profile")} T={T}/>}
          {/* WhyPremium: redirect premium users to dashboard */}
          {screen==="whypremium"&&(user?.isPremium
            ?<div style={{padding:40,textAlign:"center",color:T.muted,fontFamily:"'DM Mono',monospace",fontSize:12}}>
               <div style={{fontSize:28,marginBottom:12}}>✦</div>
               <div style={{color:T.gold,marginBottom:8}}>YOU ALREADY HAVE PREMIUM</div>
               <div style={{marginBottom:20}}>Full access is active until after the August 14 exam.</div>
               <button onClick={()=>setScreen("dashboard")} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 20px",color:T.text,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:10}}>← Back to Dashboard</button>
             </div>
            :<WhyPremiumScreen user={user} onBack={()=>setScreen("profile")} onUpgrade={()=>setShowPremiumGate(true)} T={T}/>
          )}
          {screen==="profile"&&user&&<ProfileScreen user={user} streak={streak} onBack={()=>setScreen("dashboard")} onLogout={handleLogout} onNav={handleNav} dark={dark} setDark={setDark} T={T} showToast={show} onVerifyPayment={handleManualVerify}/>}
          {screen==="editprofile"&&user&&<EditProfileScreen user={user} onBack={()=>setScreen("profile")} onSave={updated=>{setUser(updated);UserCache.set(updated);setScreen("profile");}} dark={dark} setDark={setDark} T={T} showToast={show}/>}
          {screen==="founder"&&user&&isFounder(user)&&<FounderDashboardScreen onBack={()=>setScreen("profile")} T={T} showToast={show}/>}

        </div>
      </div>

      {isMain&&<BottomNav active={screen} onChange={navChange} T={T}/>}
    </>
  );
}
