import {
  ChartBarIcon as ChartColumn,
  CurrencyDollarIcon as CircleDollarSign,
  CloudIcon as Cloud,
  CpuChipIcon as Cpu,
  GlobeAltIcon as Earth,
  FlagIcon as Flag,
  GlobeEuropeAfricaIcon as Globe,
  BuildingLibraryIcon as Landmark,
  MapPinIcon as MapPin,
  ChatBubbleLeftRightIcon as MessagesSquare,
  ComputerDesktopIcon as Monitor,
  MusicalNoteIcon as Music,
  ArrowTrendingUpIcon as TrendingUp,
  TrophyIcon as Trophy,
  BoltIcon as Zap,
} from "@heroicons/react/24/outline";
import type { HeroIcon } from "@/components/icons";
import { DEFAULT_CATEGORY } from "@/lib/categories";

/**
 * Icon per category tab, keyed by param rather than position, so adding
 * or moving a tab can't hand its neighbour the wrong icon.
 */
export const CATEGORY_ICONS: Record<string, HeroIcon> = {
  trending: TrendingUp,
  local: MapPin,
  "world-cup": Globe,
  breaking: Zap,
  politics: Landmark,
  sports: Trophy,
  crypto: CircleDollarSign,
  esports: Monitor,
  finance: ChartColumn,
  geopolitics: Flag,
  tech: Cpu,
  culture: Music,
  economy: Earth,
  weather: Cloud,
  "social-media": MessagesSquare,
};

/**
 * The default tab IS the bare "/", so it must not also be reachable at
 * ?category=<default> — that would be two URLs for the landing page, and
 * the tab would fail its own active check on one of them.
 */
export const categoryHref = (param: string) =>
  param === DEFAULT_CATEGORY ? "/" : `/?category=${param}`;
