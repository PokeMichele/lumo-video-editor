import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { TimelineItem } from "./VideoEditor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Copy, Scissors, Trash2 } from "lucide-react";

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
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(50); // pixels per second
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: string } | null>(null);
  const [copiedItem, setCopiedItem] = useState<TimelineItem | null>(null);
  const [resizing, setResizing] = useState<{ itemId: string; edge: 'left' | 'right' } | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);

  // Calcola la larghezza effettiva della timeline in base al contenuto
  const timelineWidth = Math.max(totalDuration * scale, 1000);
  const playheadPosition = currentTime * scale;

  // Handle scroll della timeline
  const handleTimelineScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft);
  };

  // Handle timeline click to change time
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (timelineContentRef.current && !isDragging && !resizing) {
      const rect = timelineContentRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left + scrollLeft;
      const newTime = clickX / scale;
      onTimeChange(Math.max(0, Math.min(newTime, totalDuration)));
    }
  };

  // Generate time markers - ora fissi rispetto al contenuto scrollabile
  const generateTimeMarkers = () => {
    const markers = [];
    const interval = totalDuration > 60 ? 10 : 5; // 10s intervals for long videos, 5s for short

    for (let i = 0; i <= totalDuration; i += interval) {
      const position = i * scale;
      markers.push(
        <div
          key={i}
          className="absolute top-0 flex flex-col items-center"
          style={{ left: `${position}px` }}
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

  // Handle context menu actions
  const handleCopy = (item: TimelineItem) => {
    setCopiedItem({ ...item, id: `${item.id}_copy` });
    setContextMenu(null);
  };

  const handlePaste = (track: number) => {
    if (copiedItem) {
      const newItem = {
        ...copiedItem,
        id: `${copiedItem.id}_${Date.now()}`,
        track,
        startTime: currentTime
      };
      onItemsChange([...items, newItem]);
    }
  };

  const handleSplit = (item: TimelineItem) => {
    const splitTime = currentTime - item.startTime;
    if (splitTime > 0 && splitTime < item.duration) {
      const firstPart = { ...item };
      const secondPart = {
        ...item,
        id: `${item.id}_split_${Date.now()}`,
        startTime: item.startTime + splitTime,
        duration: item.duration - splitTime
      };
      firstPart.duration = splitTime;

      const newItems = items.filter(i => i.id !== item.id);
      onItemsChange([...newItems, firstPart, secondPart]);
    }
    setContextMenu(null);
  };

  const handleDelete = (itemId: string) => {
    onItemsChange(items.filter(item => item.id !== itemId));
    setContextMenu(null);
  };

  // Handle drag start
  const handleMouseDown = (e: React.MouseEvent, item: TimelineItem, isResize?: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    if (isResize) {
      setResizing({ itemId: item.id, edge: isResize });
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
    setIsDragging(true);
    setDraggedItem(item.id);
  };

  // Handle mouse move for dragging and resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (resizing && timelineContentRef.current) {
        const rect = timelineContentRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + scrollLeft;
        const newTime = mouseX / scale;

        const item = items.find(i => i.id === resizing.itemId);
        if (!item) return;

        const updatedItems = items.map(i => {
          if (i.id === resizing.itemId) {
            if (resizing.edge === 'left') {
              const maxStartTime = i.startTime + i.duration - 0.1;
              const newStartTime = Math.max(0, Math.min(newTime, maxStartTime));
              const durationChange = i.startTime - newStartTime;
              return {
                ...i,
                startTime: newStartTime,
                duration: i.duration + durationChange
              };
            } else {
              const minEndTime = i.startTime + 0.1;
              const newEndTime = Math.max(minEndTime, newTime);
              return {
                ...i,
                duration: newEndTime - i.startTime
              };
            }
          }
          return i;
        });
        onItemsChange(updatedItems);
      } else if (isDragging && draggedItem && timelineContentRef.current) {
        const rect = timelineContentRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + scrollLeft;
        const mouseY = e.clientY - rect.top - 16; // Account for header

        const newTime = Math.max(0, mouseX / scale);
        const newTrack = Math.floor(mouseY / 60);

        const draggedItemData = items.find(i => i.id === draggedItem);
        if (!draggedItemData) return;

        // Validate track compatibility
        const isValidTrack = (track: number, mediaType: string) => {
          if (track < 0 || track > 2) return false;
          if (mediaType === 'video' || mediaType === 'image') return track === 0;
          if (mediaType === 'audio') return track === 1 || track === 2;
          return false;
        };

        if (isValidTrack(newTrack, draggedItemData.mediaFile.type)) {
          const updatedItems = items.map(item =>
            item.id === draggedItem
              ? { ...item, startTime: newTime, track: newTrack }
              : item
          );
          onItemsChange(updatedItems);
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDraggedItem(null);
      setResizing(null);
    };

    if (isDragging || resizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, draggedItem, resizing, items, scale, scrollLeft, onItemsChange]);

  // Render timeline item
  const renderTimelineItem = (item: TimelineItem, track: number) => {
    const left = item.startTime * scale;
    const width = item.duration * scale;

    const trackColors = {
      video: 'bg-video-track',
      audio: 'bg-audio-track',
      image: 'bg-video-track' // Images use video track color
    };

    return (
      <div
        key={item.id}
        className={`absolute h-12 rounded border-2 border-white/20 cursor-move transition-all group
          ${trackColors[item.mediaFile.type]} ${
          draggedItem === item.id ? 'opacity-50 z-20' : 'z-10'
        }`}
        style={{
          left: `${left}px`,
          width: `${width}px`,
          top: `${track * 60 + 8}px`
        }}
        onMouseDown={(e) => handleMouseDown(e, item)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, itemId: item.id });
        }}
      >
        {/* Resize handles */}
        <div
          className="absolute left-0 top-0 w-1 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/50"
          onMouseDown={(e) => handleMouseDown(e, item, 'left')}
        />
        <div
          className="absolute right-0 top-0 w-1 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/50"
          onMouseDown={(e) => handleMouseDown(e, item, 'right')}
        />

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
        <div className="absolute left-0 top-0 w-20 h-full bg-secondary/50 border-r border-border z-30"></div>
        <div
          ref={timelineRef}
          className="relative h-full cursor-pointer overflow-x-auto overflow-y-hidden ml-20"
          onScroll={handleTimelineScroll}
        >
          <div
            ref={timelineContentRef}
            className="relative h-full"
            style={{ width: `${timelineWidth}px` }}
            onClick={handleTimelineClick}
          >
            {/* Time Markers - ora posizionati in pixel fissi */}
            {generateTimeMarkers()}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-playhead z-30 pointer-events-none"
              style={{ left: `${playheadPosition}px` }}
            >
              <div className="absolute -top-1 -left-2 w-4 h-4 bg-playhead rotate-45 transform"></div>
            </div>
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
              className="h-16 flex items-center justify-center text-xs font-medium text-muted-foreground border-b border-border relative"
              style={{ top: `${index * 60}px` }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (copiedItem) {
                  const isValidTrack = (track: number, mediaType: string) => {
                    if (mediaType === 'video' || mediaType === 'image') return track === 0;
                    if (mediaType === 'audio') return track === 1 || track === 2;
                    return false;
                  };

                  if (isValidTrack(index, copiedItem.mediaFile.type)) {
                    handlePaste(index);
                  }
                }
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Timeline Content */}
        <div className="ml-20 relative h-full overflow-x-auto overflow-y-hidden" onScroll={handleTimelineScroll}>
          <div
            className="relative h-48"
            style={{ width: `${timelineWidth}px` }}
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
                  style={{ left: `${i * 10 * scale}px` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-popover border border-border rounded-md shadow-lg z-50 py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(null)}
        >
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start px-3 py-1.5 h-auto text-xs"
            onClick={() => {
              const item = items.find(i => i.id === contextMenu.itemId);
              if (item) handleCopy(item);
            }}
          >
            <Copy className="w-3 h-3 mr-2" />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start px-3 py-1.5 h-auto text-xs"
            onClick={() => {
              const item = items.find(i => i.id === contextMenu.itemId);
              if (item) handleSplit(item);
            }}
          >
            <Scissors className="w-3 h-3 mr-2" />
            Split
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start px-3 py-1.5 h-auto text-xs text-destructive hover:text-destructive"
            onClick={() => handleDelete(contextMenu.itemId)}
          >
            <Trash2 className="w-3 h-3 mr-2" />
            Delete
          </Button>
        </div>
      )}
    </div>
  );
};
