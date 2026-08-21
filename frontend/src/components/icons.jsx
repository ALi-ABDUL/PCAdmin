import { Armchair, Bed, Bike, Blocks, Camera, Car, Dumbbell, Flower2, Footprints, Gamepad2, Hammer, Headphones, Lamp, Laptop, Package, Puzzle, Shield, Shirt, Smartphone, SprayCan, Star, Tent, Tv, Utensils, Watch, Wrench } from "lucide-react";
import { Sidebar } from "./layout";

export const ICON_MAP = {
  smartphone: Smartphone, laptop: Laptop, tv: Tv, headphones: Headphones, camera: Camera,
  "gamepad-2": Gamepad2, watch: Watch, utensils: Utensils, armchair: Armchair, lamp: Lamp,
  bed: Bed, "spray-can": SprayCan, "flower-2": Flower2, drill: Wrench, wrench: Wrench,
  car: Car, hammer: Hammer, shield: Shield, shirt: Shirt, footprints: Footprints,
  dumbbell: Dumbbell, tent: Tent, bike: Bike, blocks: Blocks, puzzle: Puzzle,
  star: Star, package: Package,
};
export const CatIcon = ({ name, size = 16, ...p }) => {
  const C = ICON_MAP[name] || Package;
  return <C size={size} {...p} />;
};

/* --------------------------------- Sidebar -------------------------------- */
