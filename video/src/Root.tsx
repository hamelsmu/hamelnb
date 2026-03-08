import {Composition} from 'remotion';
import {SkillShowcase} from './SkillShowcase';

export const RemotionRoot = () => {
  return (
    <Composition
      id="SkillShowcase"
      component={SkillShowcase}
      durationInFrames={600}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
