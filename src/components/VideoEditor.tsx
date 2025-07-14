import { useState, useMemo, useEffect } from "react";
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
  mediaStartOffset?: number; // Offset in seconds from start of original media file
}

interface HistoryState {
  timelineItems: TimelineItem[];
  currentTime: number;
}

export const VideoEditor = () => {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [history, setHistory] = useState<HistoryState[]>([{ timelineItems: [], currentTime: 0 }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const { toast } = useToast();

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  // Calcola dinamicamente la durata totale basata sugli elementi nella timeline
  const totalDuration = useMemo(() => {
    if (timelineItems.length === 0) {
      return 60; // Durata minima di default (1 minuto)
    }

    const maxEndTime = timelineItems.reduce((max, item) => {
      const endTime = item.startTime + item.duration;
      return Math.max(max, endTime);
    }, 0);

    // Aggiungi un buffer del 20% o minimo 10 secondi per permettere ulteriori aggiunte
    const buffer = Math.max(maxEndTime * 0.2, 10);
    return Math.ceil(maxEndTime + buffer);
  }, [timelineItems]);

  const handleFilesAdded = (files: MediaFile[]) => {
    setMediaFiles(prev => [...prev, ...files]);
  };

  // Save state to history
  const saveToHistory = (newTimelineItems: TimelineItem[], newCurrentTime: number = currentTime) => {
    const newState: HistoryState = {
      timelineItems: newTimelineItems,
      currentTime: newCurrentTime
    };

    // Remove any future history if we're not at the end
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);

    // Limit history to 50 steps
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
      setHistoryIndex(prev => prev + 1);
    }

    setHistory(newHistory);
  };

  // Undo function
  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const previousState = history[newIndex];
      setTimelineItems(previousState.timelineItems);
      setCurrentTime(previousState.currentTime);
      setHistoryIndex(newIndex);
    }
  };

  // Redo function
  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const nextState = history[newIndex];
      setTimelineItems(nextState.timelineItems);
      setCurrentTime(nextState.currentTime);
      setHistoryIndex(newIndex);
    }
  };

  const handleItemAddedToTimeline = (item: TimelineItem) => {
    const newItems = [...timelineItems, item];
    setTimelineItems(newItems);
    saveToHistory(newItems);
  };

  const handleTimelineItemsChange = (items: TimelineItem[]) => {
    setTimelineItems(items);
  };

  const handleTimelineItemsChangeWithHistory = (items: TimelineItem[]) => {
    setTimelineItems(items);
    saveToHistory(items);
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
            timelineItems={timelineItems}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
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

              {/* Debug info */}
              <div className="mt-4 text-xs text-muted-foreground/70">
                <p>Timeline Items: {timelineItems.length}</p>
                <p>Total Duration: {Math.round(totalDuration)}s</p>
                <p>Current Time: {Math.round(currentTime)}s</p>
                <p>History: {historyIndex + 1}/{history.length}</p>
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
          onItemsChange={handleTimelineItemsChange}
          onItemsChangeWithHistory={handleTimelineItemsChangeWithHistory}
          totalDuration={totalDuration}
        />
      </div>
    </div>
  );
};
