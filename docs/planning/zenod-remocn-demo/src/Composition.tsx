import { ContextStory, STORY_FRAMES } from "./ContextStory";
import { HouseMemory } from "./HouseMemory";
import { Composition } from "remotion";
import { ZenodDemo } from "./ZenodDemo";
import { WhatsAppReceipt } from "./WhatsAppReceipt";

export const MyComposition = () => {
  return (
    <>
      <Composition
        id="ZenodContextStory"
        component={ContextStory}
        durationInFrames={STORY_FRAMES}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="ZenodHouseMemory"
        component={HouseMemory}
        durationInFrames={810}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="ZenodMemoryLoop"
        component={ZenodDemo}
        durationInFrames={683}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="ZenodWhatsAppReceipt"
        component={WhatsAppReceipt}
        durationInFrames={270}
        fps={30}
        width={1280}
        height={720}
      />
    </>
  );
};
