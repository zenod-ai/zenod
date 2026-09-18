import type { ReactNode } from "react";

import { SlideOneStorySection } from "@/components/slide-01-story";
import { SlideBatch0508 } from "@/components/slide-sections-05-08";
import { SlideNineStorySection, SlideTenStorySection } from "@/components/slide-09-10-story";
import {
  CaptureStorySection,
  CultivateStorySection,
  GroundingStorySection,
} from "@/components/story-sections-02-04";
import "./story-flow.css";

export function StoryFlow({ offer }: { offer: ReactNode }) {
  return (
    <>
      <SlideOneStorySection />
      <CaptureStorySection />
      <CultivateStorySection />
      <GroundingStorySection />
      <SlideBatch0508 offer={offer} />
      <SlideNineStorySection />
    </>
  );
}

export function ClosingStorySection() {
  return <SlideTenStorySection />;
}
