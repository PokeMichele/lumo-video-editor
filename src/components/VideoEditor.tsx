import { useState } from "react";
import { FilesBrowser } from "./FilesBrowser";
import { CompositeVideoPlayer } from "./CompositeVideoPlayer";
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
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Files Browser */}
        <div className="w-1/4 min-w-[300px] border-r border-border">
          <FilesBrowser
            files={mediaFiles}
            onFilesAdded={handleFilesAdded}
            onItemAddedToTimeline={handleItemAddedToTimeline}
          />
        </div>

        {/* Right Panel - Diviso in due sezioni */}
        <div className="flex-1 flex flex-col">
          {/* Video Player - LIMITATO A METÀ ALTEZZA */}
          <div className="h-1/2 relative bg-card border-b border-border">
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

            <CompositeVideoPlayer
              timelineItems={timelineItems}
              currentTime={currentTime}
              isPlaying={isPlaying}
              onTimeUpdate={setCurrentTime}
              onPlayStateChange={setIsPlaying}
            />
          </div>

          {/* Area inferiore - Controlli aggiuntivi */}
          <div className="h-1/2 bg-muted/10 flex items-center justify-center p-6">
            <div className="text-center text-muted-foreground">
              <h3 className="text-lg font-semibold mb-2">Additional Controls</h3>
              <p className="text-sm mb-4">
                Area per effetti, filtri e controlli avanzati
              </p>
              <div className="space-x-2">
                <Button variant="outline" size="sm">Aggiungi Effetto</Button>
                <Button variant="outline" size="sm">Regola Colori</Button>
                <Button variant="outline" size="sm">Audio Mix</Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Panel - Timeline ridotta a 1/3 */}
      <div className="h-1/3 border-t border-border bg-timeline-bg">
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
