import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { TimelineItem } from "./VideoEditor";

interface TimelineProps {
  items: TimelineItem[];
  currentTime: number;
  onTimeChange: (time: number) => void;
  onItemsChange: (items: TimelineItem[]) => void;
  totalDuration: number;
}

export const Timeline = ({ 
  items, 
  currentTime, 
  onTimeChange, 
  onItemsChange, 
  totalDuration 
}: TimelineProps) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [scale, setScale] = useState(50); // pixels per second

  const timelineWidth = totalDuration * scale;
  const playheadPosition = (currentTime / totalDuration) * 100;

  // Handle timeline click to change time
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (timelineRef.current && !isDragging) {
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const newTime = (clickX / rect.width) * totalDuration;
      onTimeChange(Math.max(0, Math.min(newTime, totalDuration)));
    }
  };

  // Generate time markers
  const generateTimeMarkers = () => {
    const markers = [];
    const interval = totalDuration > 60 ? 10 : 5; // 10s intervals for long videos, 5s for short
    
    for (let i = 0; i <= totalDuration; i += interval) {
      const position = (i / totalDuration) * 100;
      markers.push(
        <div
          key={i}
          className="absolute top-0 flex flex-col items-center"
          style={{ left: `${position}%` }}
        >
          <div className="w-px h-4 bg-timeline-ruler"></div>
          <span className="text-xs text-muted-foreground mt-1 font-mono">
            {formatTime(i)}
          </span>
        </div>
      );
    }
    return markers;
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Render timeline item
  const renderTimelineItem = (item: TimelineItem, track: number) => {
    const left = (item.startTime / totalDuration) * 100;
    const width = (item.duration / totalDuration) * 100;
    
    const trackColors = {
      video: 'bg-video-track',
      audio: 'bg-audio-track'
    };
    
    return (
      <div
        key={item.id}
        className={`absolute h-12 rounded border-2 border-white/20 cursor-move transition-all
          ${trackColors[item.mediaFile.type]} ${
          draggedItem === item.id ? 'opacity-50 z-20' : 'z-10'
        }`}
        style={{
          left: `${left}%`,
          width: `${width}%`,
          top: `${track * 60 + 8}px`
        }}
        onMouseDown={(e) => {
          setIsDragging(true);
          setDraggedItem(item.id);
          e.preventDefault();
        }}
      >
        <div className="p-2 h-full flex items-center justify-between text-white text-xs overflow-hidden">
          <span className="truncate flex-1">{item.mediaFile.name}</span>
          <span className="ml-2 font-mono">{formatTime(item.duration)}</span>
        </div>
      </div>
    );
  };

  // Group items by track
  const trackItems = [0, 1, 2].map(trackIndex => 
    items.filter(item => item.track === trackIndex)
  );

  return (
    <div className="h-full flex flex-col bg-timeline-bg">
      {/* Timeline Header with Time Markers */}
      <div className="relative h-16 bg-gradient-timeline border-b border-border">
        <div
          ref={timelineRef}
          className="relative h-full cursor-pointer overflow-hidden"
          onClick={handleTimelineClick}
        >
          {/* Time Markers */}
          {generateTimeMarkers()}
          
          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-playhead z-30 pointer-events-none"
            style={{ left: `${playheadPosition}%` }}
          >
            <div className="absolute -top-1 -left-2 w-4 h-4 bg-playhead rotate-45 transform"></div>
          </div>
        </div>
      </div>

      {/* Timeline Tracks */}
      <div className="flex-1 relative overflow-hidden">
        {/* Track Labels */}
        <div className="absolute left-0 top-0 w-20 h-full bg-secondary/50 border-r border-border z-20">
          {['Video', 'Audio 1', 'Audio 2'].map((label, index) => (
            <div
              key={label}
              className="h-16 flex items-center justify-center text-xs font-medium text-muted-foreground border-b border-border"
              style={{ top: `${index * 60}px` }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Timeline Content */}
        <div className="ml-20 relative h-full overflow-x-auto overflow-y-hidden">
          <div 
            className="relative h-48"
            style={{ width: Math.max(timelineWidth, 800) }}
          >
            {/* Track Backgrounds */}
            {[0, 1, 2].map(track => (
              <div
                key={track}
                className="absolute w-full h-14 border-b border-border/30"
                style={{ top: `${track * 60 + 8}px` }}
              />
            ))}

            {/* Timeline Items */}
            {trackItems.map((trackItems, trackIndex) =>
              trackItems.map(item => renderTimelineItem(item, trackIndex))
            )}

            {/* Grid Lines */}
            <div className="absolute inset-0 pointer-events-none">
              {Array.from({ length: Math.ceil(totalDuration / 10) }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 w-px bg-border/30"
                  style={{ left: `${(i * 10 / totalDuration) * 100}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};