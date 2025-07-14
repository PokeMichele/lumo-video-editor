import { useRef, useEffect, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import { TimelineItem } from "./VideoEditor";

interface VideoPlayerProps {
  timelineItems: TimelineItem[];
  currentTime: number;
  isPlaying: boolean;
  onTimeUpdate: (time: number) => void;
  onPlayStateChange: (playing: boolean) => void;
}

export const VideoPlayer = ({ 
  timelineItems, 
  currentTime, 
  isPlaying, 
  onTimeUpdate, 
  onPlayStateChange 
}: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [volume, setVolume] = useState(100);
  const [currentVideoItem, setCurrentVideoItem] = useState<TimelineItem | null>(null);

  // Find the current video item based on timeline
  useEffect(() => {
    const videoItem = timelineItems.find(item => 
      item.mediaFile.type === 'video' &&
      currentTime >= item.startTime && 
      currentTime < item.startTime + item.duration
    );
    setCurrentVideoItem(videoItem || null);
  }, [timelineItems, currentTime]);

  // Update video element when current video changes
  useEffect(() => {
    if (videoRef.current && currentVideoItem) {
      videoRef.current.src = currentVideoItem.mediaFile.url;
      const relativeTime = currentTime - currentVideoItem.startTime;
      videoRef.current.currentTime = relativeTime;
    }
  }, [currentVideoItem, currentTime]);

  // Handle play/pause
  useEffect(() => {
    if (videoRef.current) {
      if (isPlaying && currentVideoItem) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  }, [isPlaying, currentVideoItem]);

  const handlePlayPause = () => {
    onPlayStateChange(!isPlaying);
  };

  const handleSeekBackward = () => {
    onTimeUpdate(Math.max(0, currentTime - 5));
  };

  const handleSeekForward = () => {
    onTimeUpdate(currentTime + 5);
  };

  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    if (videoRef.current) {
      videoRef.current.volume = newVolume / 100;
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Video Display Area */}
      <div className="flex-1 flex items-center justify-center bg-black/50 relative">
        {currentVideoItem ? (
          <video
            ref={videoRef}
            className="max-w-full max-h-full object-contain"
            onTimeUpdate={(e) => {
              const video = e.target as HTMLVideoElement;
              const relativeTime = video.currentTime + currentVideoItem.startTime;
              onTimeUpdate(relativeTime);
            }}
            onEnded={() => onPlayStateChange(false)}
          />
        ) : (
          <div className="text-center text-muted-foreground">
            <div className="text-6xl mb-4">🎬</div>
            <p className="text-lg">No video selected</p>
            <p className="text-sm">Add video files to timeline to preview</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <Card className="m-4 p-4 bg-card/95 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          {/* Playback Controls */}
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSeekBackward}
              className="hover:bg-accent"
            >
              <SkipBack className="w-4 h-4" />
            </Button>
            
            <Button
              onClick={handlePlayPause}
              size="lg"
              className="bg-gradient-primary hover:opacity-90"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-1" />
              )}
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSeekForward}
              className="hover:bg-accent"
            >
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          {/* Time Display */}
          <div className="text-sm text-muted-foreground font-mono">
            {formatTime(currentTime)}
          </div>

          {/* Volume Control */}
          <div className="flex items-center space-x-2 w-32">
            <Volume2 className="w-4 h-4 text-muted-foreground" />
            <Slider
              value={[volume]}
              onValueChange={handleVolumeChange}
              max={100}
              step={1}
              className="flex-1"
            />
          </div>
        </div>
      </Card>
    </div>
  );
};