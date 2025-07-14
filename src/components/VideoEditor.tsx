import { useState } from "react";
import { FilesBrowser } from "./FilesBrowser";
import { VideoPlayer } from "./VideoPlayer";
import { Timeline } from "./Timeline";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface MediaFile {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  url: string;
  duration: number;
  file: File;
}

export interface TimelineItem {
  id: string;
  mediaFile: MediaFile;
  startTime: number;
  duration: number;
  track: number; // 0, 1, or 2
}

export const VideoEditor = () => {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const { toast } = useToast();

  const handleFilesAdded = (files: MediaFile[]) => {
    setMediaFiles(prev => [...prev, ...files]);
  };

  const handleItemAddedToTimeline = (item: TimelineItem) => {
    setTimelineItems(prev => [...prev, item]);
  };

  const handleExport = () => {
    toast({
      title: "Export Started",
      description: "Your video is being rendered. This may take a few minutes.",
    });
    
    // Here you would implement the actual export functionality
    // For now, we'll just show a success message after a delay
    setTimeout(() => {
      toast({
        title: "Export Complete",
        description: "Your video has been successfully exported!",
      });
    }, 3000);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Main Content Area */}
      <div className="flex-1 flex">
        {/* Left Panel - Files Browser */}
        <div className="w-1/4 min-w-[300px] border-r border-border">
          <FilesBrowser 
            files={mediaFiles} 
            onFilesAdded={handleFilesAdded}
            onItemAddedToTimeline={handleItemAddedToTimeline}
          />
        </div>

        {/* Right Panel - Video Player */}
        <div className="flex-1 relative bg-card">
          <div className="absolute top-4 right-4 z-10">
            <Button 
              onClick={handleExport}
              className="bg-gradient-primary hover:opacity-90 shadow-elegant"
              size="lg"
            >
              <Download className="w-4 h-4 mr-2" />
              Export Video
            </Button>
          </div>
          
          <VideoPlayer
            timelineItems={timelineItems}
            currentTime={currentTime}
            isPlaying={isPlaying}
            onTimeUpdate={setCurrentTime}
            onPlayStateChange={setIsPlaying}
          />
        </div>
      </div>

      {/* Bottom Panel - Timeline */}
      <div className="h-1/2 border-t border-border bg-timeline-bg">
        <Timeline
          items={timelineItems}
          currentTime={currentTime}
          onTimeChange={setCurrentTime}
          onItemsChange={setTimelineItems}
          totalDuration={300} // 5 minutes default
        />
      </div>
    </div>
  );
};