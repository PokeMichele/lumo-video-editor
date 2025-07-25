import { useState, useRef, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { TimelineItem } from "./VideoEditor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Copy, Scissors, Trash2, Plus, Minus, Clipboard } from "lucide-react";

interface TimelineProps {
  items: TimelineItem[];
  currentTime: number;
  onTimeChange: (time: number) => void;
  onItemsChange: (items: TimelineItem[]) => void;
  onItemsChangeWithHistory: (items: TimelineItem[]) => void;
  totalDuration: number;
  tracks: Track[];
  onTracksChange: (tracks: Track[]) => void;
  onItemSelect?: (itemId: string | undefined) => void;
}

export interface Track {
  id: string;
  type: 'video' | 'audio';
  index: number;
  label: string;
}

// Throttle function per limitare la frequenza delle chiamate
const throttle = (func: Function, limit: number) => {
  let inThrottle: boolean;
  return function(this: any, ...args: any[]) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  }
};

export const Timeline = ({
  items,
  currentTime,
  onTimeChange,
  onItemsChange,
  onItemsChangeWithHistory,
  totalDuration,
  tracks,
  onTracksChange,
  onItemSelect
}: TimelineProps) => {
  const timelineHeaderContentRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(50); // pixels per second
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId?: string; selectedItems?: string[] } | null>(null);
  const [copiedItem, setCopiedItem] = useState<TimelineItem | null>(null);
  const [copiedItems, setCopiedItems] = useState<TimelineItem[]>([]); // Per copia multipla
  const [cutItems, setCutItems] = useState<TimelineItem[]>([]); // Per il cut
  const [resizing, setResizing] = useState<{ itemId: string; edge: 'left' | 'right' } | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0); // Aggiunto per scroll verticale
  
  // Stati per la selezione multipla
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  
  // Stati per il magnetic snap
  const [snapThreshold] = useState(15); // pixels per il snap
  const [activeSnapLines, setActiveSnapLines] = useState<number[]>([]);
  
  // Stato per il drag con snap (incluso drag multiplo)
  const [dragState, setDragState] = useState<{
    startX: number;
    startY: number;
    originalStartTime: number;
    originalTrack: number;
    currentStartTime: number;
    currentTrack: number;
    snapPoints: { time: number; type: 'start' | 'end' | 'timeline-start' }[];
    potentialSnapTime?: number; // Tempo di snap potenziale
    isInSnapRange: boolean; // Se è dentro la soglia di snap
    // Per drag multiplo
    draggedItems: {
      id: string;
      originalStartTime: number;
      originalTrack: number;
      timeOffset: number; // Offset rispetto all'elemento principale
      trackOffset: number; // Offset di track rispetto all'elemento principale
    }[];
  } | null>(null);

  // Limiti per lo zoom
  const minScale = 10;
  const maxScale = 200;

  // Scorciatoie da tastiera
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Solo se non siamo in un input o textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'c':
            e.preventDefault();
            handleCopyKeyboard();
            break;
          case 'x':
            e.preventDefault();
            handleCutKeyboard();
            break;
          case 'v':
            e.preventDefault();
            handlePasteKeyboard();
            break;
        }
      } else if (e.key === 'Delete') {
        e.preventDefault();
        handleDeleteKeyboard();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, items, currentTime]);

  // Funzioni per le scorciatoie da tastiera
  const handleCopyKeyboard = () => {
    if (selectedItems.size > 1) {
      const itemsToCopy = items.filter(i => selectedItems.has(i.id));
      setCopiedItems(itemsToCopy.map(i => ({ ...i, id: `${i.id}_copy` })));
      setCopiedItem(null);
      setCutItems([]);
    } else if (selectedItems.size === 1) {
      const itemId = Array.from(selectedItems)[0];
      const item = items.find(i => i.id === itemId);
      if (item) {
        setCopiedItem({ ...item, id: `${item.id}_copy` });
        setCopiedItems([]);
        setCutItems([]);
      }
    }
  };

  const handleCutKeyboard = () => {
    if (selectedItems.size > 0) {
      const itemsToCut = items.filter(i => selectedItems.has(i.id));
      setCutItems(itemsToCut.map(i => ({ ...i })));
      setCopiedItems([]);
      setCopiedItem(null);
      
      // Rimuovi gli elementi dalla timeline
      const newItems = items.filter(item => !selectedItems.has(item.id));
      onItemsChangeWithHistory(newItems);
      setSelectedItems(new Set());
    }
  };

  const handlePasteKeyboard = () => {
    // Trova la traccia più appropriata in base al tipo di contenuto
    const getTargetTrack = (mediaType: string) => {
      if (mediaType === 'video' || mediaType === 'image' || mediaType === 'effect') {
        return tracks.find(t => t.type === 'video')?.index || 0;
      } else if (mediaType === 'audio') {
        return tracks.find(t => t.type === 'audio')?.index || 1;
      }
      return 0;
    };

    if (cutItems.length > 0) {
      // Incolla elementi tagliati
      const newItems = cutItems.map(cutItem => ({
        ...cutItem,
        id: `${cutItem.id}_paste_${Date.now()}_${Math.random()}`,
        track: getTargetTrack(cutItem.mediaFile.type),
        startTime: currentTime,
        mediaStartOffset: cutItem.mediaStartOffset || 0
      }));
      onItemsChangeWithHistory([...items, ...newItems]);
      setCutItems([]);
    } else if (copiedItems.length > 0) {
      // Incolla elementi copiati
      const newItems = copiedItems.map(copiedItem => ({
        ...copiedItem,
        id: `${copiedItem.id}_paste_${Date.now()}_${Math.random()}`,
        track: getTargetTrack(copiedItem.mediaFile.type),
        startTime: currentTime,
        mediaStartOffset: copiedItem.mediaStartOffset || 0
      }));
      onItemsChangeWithHistory([...items, ...newItems]);
    } else if (copiedItem) {
      // Incolla elemento singolo copiato
      const newItem = {
        ...copiedItem,
        id: `${copiedItem.id}_paste_${Date.now()}`,
        track: getTargetTrack(copiedItem.mediaFile.type),
        startTime: currentTime,
        mediaStartOffset: copiedItem.mediaStartOffset || 0
      };
      onItemsChangeWithHistory([...items, newItem]);
    }
  };

  const handleDeleteKeyboard = () => {
    if (selectedItems.size > 0) {
      const newItems = items.filter(item => !selectedItems.has(item.id));
      onItemsChangeWithHistory(newItems);
      setSelectedItems(new Set());
      // Deseleziona anche nell'editor principale
      if (onItemSelect) {
        onItemSelect(undefined);
      }
    }
  };

  // Zoom functionality con Ctrl+Scroll
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        
        const zoomFactor = 1.1;
        const delta = e.deltaY;
        
        setScale(prevScale => {
          let newScale;
          if (delta < 0) {
            newScale = prevScale * zoomFactor;
          } else {
            newScale = prevScale / zoomFactor;
          }
          
          return Math.max(minScale, Math.min(maxScale, newScale));
        });
      }
    };

    const timelineElement = timelineContentRef.current;
    if (timelineElement) {
      timelineElement.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (timelineElement) {
        timelineElement.removeEventListener('wheel', handleWheel);
      }
    };
  }, [minScale, maxScale]);

  // Calcola la larghezza effettiva della timeline
  const timelineWidth = Math.max(totalDuration * scale, 1000,
    ...items.map(item => (item.startTime + item.duration) * scale + 100)
  );
  const playheadPosition = currentTime * scale;
  
  // Calcola l'altezza totale della timeline basata sul numero di tracce
  const timelineHeight = tracks.length * 60 + 16; // 60px per traccia + padding

  // Apply dark scrollbar styles
  useEffect(() => {
    if (timelineContentRef.current) {
      const element = timelineContentRef.current;
      const style = document.createElement('style');
      style.textContent = `
        .timeline-scrollbar::-webkit-scrollbar {
          height: 12px;
        }
        .timeline-scrollbar::-webkit-scrollbar-track {
          background: #1f2937;
          border-radius: 6px;
        }
        .timeline-scrollbar::-webkit-scrollbar-thumb {
          background: #374151;
          border-radius: 6px;
          border: 2px solid #1f2937;
        }
        .timeline-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #4b5563;
        }
      `;
      document.head.appendChild(style);
      element.classList.add('timeline-scrollbar');

      return () => {
        document.head.removeChild(style);
      };
    }
  }, []);

  // Handle scroll della timeline - sincronizza orizzontale e verticale
  const handleTimelineContentScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const newScrollLeft = e.currentTarget.scrollLeft;
    const newScrollTop = e.currentTarget.scrollTop;
    
    setScrollLeft(newScrollLeft);
    setScrollTop(newScrollTop);

    // Sincronizza l'header orizzontalmente
    if (timelineHeaderContentRef.current) {
      timelineHeaderContentRef.current.style.transform = `translateX(-${newScrollLeft}px)`;
    }

    // Sincronizza le label verticalmente
    const trackLabelsElement = document.querySelector('.track-labels-container') as HTMLElement;
    if (trackLabelsElement) {
      trackLabelsElement.style.transform = `translateY(-${newScrollTop}px)`;
    }
  };

  // Handle timeline click to change time
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!isDragging && !resizing && !draggedItem && !isSelecting) {
      const mouseX = e.clientX - 80 + scrollLeft;
      const newTime = mouseX / scale;
      onTimeChange(Math.max(0, Math.min(newTime, totalDuration)));
    }
  };

  // Generate time markers
  const generateTimeMarkers = () => {
    const markers = [];
    
    let interval = 5;
    if (scale < 20) {
      interval = 30;
    } else if (scale < 40) {
      interval = 15;
    } else if (scale > 100) {
      interval = 1;
    } else if (scale > 80) {
      interval = 2;
    }

    for (let i = 0; i <= totalDuration; i += interval) {
      const position = i * scale;
      const isFirstMarker = i === 0;
      
      markers.push(
        <div
          key={i}
          className="absolute top-0"
          style={{ left: `${position}px` }}
        >
          <div 
            className="bg-timeline-ruler"
            style={{
              width: '1px',
              height: '16px',
              position: 'absolute',
              left: '0px',
              top: '0px'
            }}
          ></div>
          <span 
            className="text-xs text-muted-foreground font-mono"
            style={{
              position: 'absolute',
              top: '20px',
              left: isFirstMarker ? '0px' : '-20px',
              minWidth: '40px',
              textAlign: isFirstMarker ? 'left' : 'center'
            }}
          >
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

  // Calculate snap points for magnetic borders
  const calculateSnapPoints = useCallback((draggedItemId: string, targetTrack: number) => {
    const snapPoints: { time: number; type: 'start' | 'end' | 'timeline-start' }[] = [];

    // Always snap to timeline start
    snapPoints.push({ time: 0, type: 'timeline-start' });

    // Get all items in the same track except the dragged one
    const otherItemsInTrack = items.filter(item =>
      item.track === targetTrack && item.id !== draggedItemId
    );

    // Add start and end points of all other items
    otherItemsInTrack.forEach(item => {
      snapPoints.push({ time: item.startTime, type: 'start' });
      snapPoints.push({ time: item.startTime + item.duration, type: 'end' });
    });

    return snapPoints.sort((a, b) => a.time - b.time);
  }, [items]);

  // Find potential snap point (per il feedback visivo)
  const findPotentialSnapPoint = useCallback((currentTime: number, duration: number, snapPoints: { time: number; type: 'start' | 'end' | 'timeline-start' }[]) => {
    const snapThresholdTime = snapThreshold / scale;
    
    // Controlla snap per l'inizio dell'elemento
    for (const snapPoint of snapPoints) {
      if (Math.abs(currentTime - snapPoint.time) <= snapThresholdTime) {
        return {
          snapTime: snapPoint.time,
          snapLine: snapPoint.time,
          type: 'start'
        };
      }
    }
    
    // Controlla snap per la fine dell'elemento
    for (const snapPoint of snapPoints) {
      if (Math.abs((currentTime + duration) - snapPoint.time) <= snapThresholdTime) {
        return {
          snapTime: snapPoint.time - duration,
          snapLine: snapPoint.time,
          type: 'end'
        };
      }
    }
    
    return null;
  }, [scale, snapThreshold]);

  // Validate track compatibility con sistema dinamico - AGGIORNATO per supportare effetti
  const isValidTrack = useCallback((trackIndex: number, mediaType: string) => {
    const track = tracks.find(t => t.index === trackIndex);
    if (!track) return false;
    
    if (mediaType === 'video' || mediaType === 'image' || mediaType === 'effect') {
      return track.type === 'video';
    }
    if (mediaType === 'audio') {
      return track.type === 'audio';
    }
    return false;
  }, [tracks]);

  // Aggiungi nuova traccia
  const addTrack = useCallback((type: 'video' | 'audio', afterIndex: number) => {
    const newTracks = [...tracks];
    
    // Trova tutte le tracce dello stesso tipo
    const sameTypeTracks = newTracks.filter(t => t.type === type);
    const tracksOfOtherType = newTracks.filter(t => t.type !== type);
    
    // Calcola il nuovo indice (dove inserire fisicamente la traccia)
    const insertIndex = afterIndex + 1;
    
    // Sposta tutti gli indici delle tracce successive
    newTracks.forEach(track => {
      if (track.index >= insertIndex) {
        track.index += 1;
      }
    });
    
    // Aggiorna gli elementi nella timeline spostando le tracce successive
    const updatedItems = items.map(item => {
      if (item.track >= insertIndex) {
        return { ...item, track: item.track + 1 };
      }
      return item;
    });
    
    // Crea la nuova traccia
    const newTrackId = `${type}-${Date.now()}`;
    const newTrack: Track = {
      id: newTrackId,
      type,
      index: insertIndex,
      label: `${type === 'video' ? 'Video' : 'Audio'} ${sameTypeTracks.length + 1}`
    };
    
    // Rinumera le etichette delle tracce dello stesso tipo
    const updatedTracks = [...newTracks, newTrack]
      .sort((a, b) => a.index - b.index)
      .map(track => {
        if (track.type === type) {
          const sameTypeTracksOrdered = newTracks
            .filter(t => t.type === type && t.index <= track.index)
            .sort((a, b) => a.index - b.index);
          
          const trackNumber = sameTypeTracksOrdered.findIndex(t => t.index === track.index) + 1 + 
            (track.index >= insertIndex ? 1 : 0);
          
          return {
            ...track,
            label: `${type === 'video' ? 'Video' : 'Audio'} ${trackNumber}`
          };
        }
        return track;
      });
    
    // Rinumera correttamente tutte le tracce dello stesso tipo
    let videoCounter = 1;
    let audioCounter = 1;
    
    const finalTracks = updatedTracks
      .sort((a, b) => a.index - b.index)
      .map(track => {
        if (track.type === 'video') {
          return { ...track, label: `Video ${videoCounter++}` };
        } else {
          return { ...track, label: `Audio ${audioCounter++}` };
        }
      });
    
    onTracksChange(finalTracks);
    onItemsChangeWithHistory(updatedItems);
  }, [tracks, items, onItemsChangeWithHistory, onTracksChange]);

  // Rimuovi traccia
  const removeTrack = useCallback((trackToRemove: Track) => {
    const sameTypeTracks = tracks.filter(t => t.type === trackToRemove.type);
    
    // Verifica che ci sia sempre almeno una traccia video e una audio
    if (sameTypeTracks.length <= 1) {
      return; // Non permettere la rimozione dell'ultima traccia del tipo
    }
    
    // Verifica che la traccia non abbia elementi
    const hasItems = items.some(item => item.track === trackToRemove.index);
    if (hasItems) {
      return; // Non permettere la rimozione di tracce con elementi
    }
    
    // Rimuovi la traccia
    const newTracks = tracks.filter(t => t.id !== trackToRemove.id);
    
    // Aggiorna gli indici delle tracce successive
    newTracks.forEach(track => {
      if (track.index > trackToRemove.index) {
        track.index -= 1;
      }
    });
    
    // Aggiorna gli elementi nella timeline spostando le tracce successive
    const updatedItems = items.map(item => {
      if (item.track > trackToRemove.index) {
        return { ...item, track: item.track - 1 };
      }
      return item;
    });
    
    // Rinumera correttamente tutte le tracce dello stesso tipo
    let videoCounter = 1;
    let audioCounter = 1;
    
    const finalTracks = newTracks
      .sort((a, b) => a.index - b.index)
      .map(track => {
        if (track.type === 'video') {
          return { ...track, label: `Video ${videoCounter++}` };
        } else {
          return { ...track, label: `Audio ${audioCounter++}` };
        }
      });
    
    onTracksChange(finalTracks);
    onItemsChangeWithHistory(updatedItems);
  }, [tracks, items, onItemsChangeWithHistory, onTracksChange]);

  // Verifica se una traccia può essere rimossa
  const canRemoveTrack = useCallback((track: Track) => {
    const sameTypeTracks = tracks.filter(t => t.type === track.type);
    const hasItems = items.some(item => item.track === track.index);
    
    return sameTypeTracks.length > 1 && !hasItems;
  }, [tracks, items]);

  // Calcola gli elementi dentro il rettangolo di selezione
  const getItemsInSelectionRect = useCallback(() => {
    if (!selectionStart || !selectionEnd) return [];

    const left = Math.min(selectionStart.x, selectionEnd.x);
    const right = Math.max(selectionStart.x, selectionEnd.x);
    const top = Math.min(selectionStart.y, selectionEnd.y);
    const bottom = Math.max(selectionStart.y, selectionEnd.y);

    return items.filter(item => {
      const itemLeft = item.startTime * scale;
      const itemRight = itemLeft + item.duration * scale;
      const itemTop = item.track * 60 + 8;
      const itemBottom = itemTop + 48; // altezza elemento

      // Controlla se c'è sovrapposizione
      return !(itemRight < left || itemLeft > right || itemBottom < top || itemTop > bottom);
    });
  }, [selectionStart, selectionEnd, items, scale]);

  // Handle context menu actions
  const handleCopy = (item?: TimelineItem) => {
    if (selectedItems.size > 1) {
      // Copia multipla
      const itemsToCopy = items.filter(i => selectedItems.has(i.id));
      setCopiedItems(itemsToCopy.map(i => ({ ...i, id: `${i.id}_copy` })));
      setCopiedItem(null);
      setCutItems([]);
    } else if (item) {
      // Copia singola
      setCopiedItem({ ...item, id: `${item.id}_copy` });
      setCopiedItems([]);
      setCutItems([]);
    }
    setContextMenu(null);
  };

  const handleCut = (item?: TimelineItem) => {
    if (selectedItems.size > 1) {
      // Taglia multiplo
      const itemsToCut = items.filter(i => selectedItems.has(i.id));
      setCutItems(itemsToCut.map(i => ({ ...i })));
      setCopiedItems([]);
      setCopiedItem(null);
      
      // Rimuovi gli elementi dalla timeline
      const newItems = items.filter(item => !selectedItems.has(item.id));
      onItemsChangeWithHistory(newItems);
      setSelectedItems(new Set());
    } else if (item) {
      // Taglia singolo
      setCutItems([{ ...item }]);
      setCopiedItems([]);
      setCopiedItem(null);
      
      // Rimuovi l'elemento dalla timeline
      onItemsChangeWithHistory(items.filter(i => i.id !== item.id));
    }
    setContextMenu(null);
  };

  const handlePaste = (track: number) => {
    if (cutItems.length > 0) {
      // Incolla elementi tagliati
      const newItems = cutItems.map(cutItem => ({
        ...cutItem,
        id: `${cutItem.id}_paste_${Date.now()}_${Math.random()}`,
        track: isValidTrack(track, cutItem.mediaFile.type) ? track : cutItem.track,
        startTime: currentTime,
        mediaStartOffset: cutItem.mediaStartOffset || 0
      }));
      onItemsChangeWithHistory([...items, ...newItems]);
      setCutItems([]);
    } else if (copiedItems.length > 0) {
      // Incolla elementi copiati
      const newItems = copiedItems.map(copiedItem => ({
        ...copiedItem,
        id: `${copiedItem.id}_paste_${Date.now()}_${Math.random()}`,
        track: isValidTrack(track, copiedItem.mediaFile.type) ? track : copiedItem.track,
        startTime: currentTime,
        mediaStartOffset: copiedItem.mediaStartOffset || 0
      }));
      onItemsChangeWithHistory([...items, ...newItems]);
    } else if (copiedItem) {
      // Incolla elemento singolo copiato
      const newItem = {
        ...copiedItem,
        id: `${copiedItem.id}_paste_${Date.now()}`,
        track,
        startTime: currentTime,
        mediaStartOffset: copiedItem.mediaStartOffset || 0
      };
      onItemsChangeWithHistory([...items, newItem]);
    }
  };

  const handleSplit = (item: TimelineItem) => {
    const splitTime = currentTime - item.startTime;
    if (splitTime > 0 && splitTime < item.duration) {
      const originalMediaOffset = item.mediaStartOffset || 0;

      const firstPart = {
        ...item,
        duration: splitTime,
        mediaStartOffset: originalMediaOffset
      };

      const secondPart = {
        ...item,
        id: `${item.id}_split_${Date.now()}`,
        startTime: item.startTime + splitTime,
        duration: item.duration - splitTime,
        mediaStartOffset: originalMediaOffset + splitTime
      };

      const newItems = items.filter(i => i.id !== item.id);
      onItemsChangeWithHistory([...newItems, firstPart, secondPart]);
    }
    setContextMenu(null);
  };

  const handleDelete = (itemId?: string) => {
    if (selectedItems.size > 1) {
      // Eliminazione multipla
      const newItems = items.filter(item => !selectedItems.has(item.id));
      onItemsChangeWithHistory(newItems);
      setSelectedItems(new Set());
    } else if (itemId) {
      // Eliminazione singola
      onItemsChangeWithHistory(items.filter(item => item.id !== itemId));
    }
    setContextMenu(null);
    
    // Deseleziona anche nell'editor principale
    if (onItemSelect) {
      onItemSelect(undefined);
    }
  };

  // Handle item selection
  const handleItemClick = (e: React.MouseEvent, item: TimelineItem) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Click: aggiungi/rimuovi dalla selezione
      e.preventDefault();
      e.stopPropagation();
      
      setSelectedItems(prev => {
        const newSelection = new Set(prev);
        if (newSelection.has(item.id)) {
          newSelection.delete(item.id);
        } else {
          newSelection.add(item.id);
        }
        return newSelection;
      });
    } else {
      // Click normale: seleziona solo questo elemento
      setSelectedItems(new Set([item.id]));
      // Notifica l'editor principale della selezione
      if (onItemSelect) {
        onItemSelect(item.id);
      }
    }
  };

  // Handle drag start
  const handleMouseDown = (e: React.MouseEvent, item?: TimelineItem, isResize?: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();

    if (isResize && item) {
      setResizing({ itemId: item.id, edge: isResize });
      return;
    }

    if (item) {
      // Drag di un elemento
      const rect = timelineContentRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left + scrollLeft;
      const mouseY = e.clientY - rect.top + scrollTop; // Aggiunto scrollTop

      // Se l'elemento non è selezionato e non si tiene Ctrl, selezionalo
      if (!selectedItems.has(item.id) && !(e.ctrlKey || e.metaKey)) {
        setSelectedItems(new Set([item.id]));
        if (onItemSelect) {
          onItemSelect(item.id);
        }
      }

      // Prepara dati per drag multiplo
      const currentSelection = selectedItems.has(item.id) ? selectedItems : new Set([item.id]);
      const draggedItemsData = Array.from(currentSelection).map(itemId => {
        const targetItem = items.find(i => i.id === itemId);
        if (!targetItem) return null;

        return {
          id: itemId,
          originalStartTime: targetItem.startTime,
          originalTrack: targetItem.track,
          timeOffset: targetItem.startTime - item.startTime, // Offset rispetto all'elemento principale
          trackOffset: targetItem.track - item.track // Offset di track rispetto all'elemento principale
        };
      }).filter(Boolean) as {
        id: string;
        originalStartTime: number;
        originalTrack: number;
        timeOffset: number;
        trackOffset: number;
      }[];

      // Calcola i punti di snap per la track corrente dell'elemento principale
      const snapPoints = calculateSnapPoints(item.id, item.track);

      // Stato del drag con snap e supporto multiplo
      setDragState({
        startX: mouseX,
        startY: mouseY,
        originalStartTime: item.startTime,
        originalTrack: item.track,
        currentStartTime: item.startTime,
        currentTrack: item.track,
        snapPoints,
        isInSnapRange: false,
        draggedItems: draggedItemsData
      });

      setIsDragging(true);
      setDraggedItem(item.id);
    } else {
      // Inizio selezione rettangolare
      const rect = timelineContentRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = e.clientX - rect.left + scrollLeft;
      const mouseY = e.clientY - rect.top + scrollTop; // Aggiunto scrollTop

      setIsSelecting(true);
      setSelectionStart({ x: mouseX, y: mouseY });
      setSelectionEnd({ x: mouseX, y: mouseY });

      // Pulisci selezione se non si tiene Ctrl
      if (!(e.ctrlKey || e.metaKey)) {
        setSelectedItems(new Set());
        if (onItemSelect) {
          onItemSelect(undefined);
        }
      }
    }
  };

  // Handle selezione rettangolare sulla timeline vuota
  const handleTimelineMouseDown = (e: React.MouseEvent) => {
    // Solo se clicca su area vuota (non su elementi)
    if (!isDragging && !resizing) {
      handleMouseDown(e);
    }
  };

  // Handle context menu su area vuota della timeline
  const handleTimelineContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Mostra il menu solo se c'è contenuto da incollare
    if (hasContentToPaste) {
      setContextMenu({ 
        x: e.clientX, 
        y: e.clientY 
      });
    }
  };

  // Handle mouse move con snap magnetico
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineContentRef.current) return;
      const rect = timelineContentRef.current.getBoundingClientRect();

      if (isSelecting && selectionStart) {
        // Aggiorna selezione rettangolare
        const mouseX = e.clientX - rect.left + scrollLeft;
        const mouseY = e.clientY - rect.top + scrollTop; // Aggiunto scrollTop
        
        setSelectionEnd({ x: mouseX, y: mouseY });

        // Calcola elementi nella selezione in tempo reale
        const itemsInRect = getItemsInSelectionRect();
        const newSelection = new Set(selectedItems);
        
        itemsInRect.forEach(item => {
          if (e.ctrlKey || e.metaKey) {
            // Con Ctrl: toggle
            if (selectedItems.has(item.id)) {
              newSelection.delete(item.id);
            } else {
              newSelection.add(item.id);
            }
          } else {
            // Senza Ctrl: aggiungi
            newSelection.add(item.id);
          }
        });

        setSelectedItems(newSelection);
      } else if (resizing) {
        // Logica di resize con snap
        const mouseX = e.clientX - rect.left + scrollLeft;
        const newTime = mouseX / scale;

        const item = items.find(i => i.id === resizing.itemId);
        if (!item) return;

        const snapPoints = calculateSnapPoints(resizing.itemId, item.track);
        const snapThresholdTime = snapThreshold / scale;

        const updatedItems = items.map(i => {
          if (i.id === resizing.itemId) {
            if (resizing.edge === 'left') {
              const maxStartTime = i.startTime + i.duration - 0.1;
              let newStartTime = newTime;
              let snapLineTime: number | undefined;

              // Cerca snap per il resize left
              for (const snapPoint of snapPoints) {
                if (Math.abs(newTime - snapPoint.time) <= snapThresholdTime) {
                  newStartTime = snapPoint.time;
                  snapLineTime = snapPoint.time;
                  break;
                }
              }

              newStartTime = Math.max(0, Math.min(newStartTime, maxStartTime));
              const durationChange = i.startTime - newStartTime;

              // Aggiorna snap lines
              if (snapLineTime !== undefined) {
                setActiveSnapLines([snapLineTime]);
              } else {
                setActiveSnapLines([]);
              }

              return {
                ...i,
                startTime: newStartTime,
                duration: i.duration + durationChange
              };
            } else {
              const minEndTime = i.startTime + 0.1;
              let newEndTime = newTime;
              let snapLineTime: number | undefined;

              // Cerca snap per il resize right
              for (const snapPoint of snapPoints) {
                if (Math.abs(newTime - snapPoint.time) <= snapThresholdTime) {
                  newEndTime = snapPoint.time;
                  snapLineTime = snapPoint.time;
                  break;
                }
              }

              newEndTime = Math.max(minEndTime, newEndTime);

              // Aggiorna snap lines
              if (snapLineTime !== undefined) {
                setActiveSnapLines([snapLineTime]);
              } else {
                setActiveSnapLines([]);
              }

              return {
                ...i,
                duration: newEndTime - i.startTime
              };
            }
          }
          return i;
        });
        
        onItemsChange(updatedItems);
      } else if (isDragging && draggedItem && dragState) {
        // Logica di drag con snap magnetico
        const mouseX = e.clientX - rect.left + scrollLeft;
        const mouseY = e.clientY - rect.top - 16;

        const deltaX = mouseX - dragState.startX;
        const deltaY = mouseY - dragState.startY;

        // Calcola nuova posizione senza snap
        const rawNewTime = Math.max(0, dragState.originalStartTime + deltaX / scale);
        const newTrack = Math.max(0, Math.min(tracks.length - 1, dragState.originalTrack + Math.round(deltaY / 60)));

        const draggedItemData = items.find(i => i.id === draggedItem);
        if (!draggedItemData) return;

        // Aggiorna i punti di snap se cambia track
        let currentSnapPoints = dragState.snapPoints;
        if (newTrack !== dragState.currentTrack) {
          currentSnapPoints = calculateSnapPoints(draggedItem, newTrack);
        }

        // Trova potenziale snap point
        const potentialSnap = findPotentialSnapPoint(rawNewTime, draggedItemData.duration, currentSnapPoints);
        
        let finalTime = rawNewTime;
        let snapLines: number[] = [];
        let isInSnapRange = false;

        if (potentialSnap) {
          // Mostra la linea di snap
          snapLines = [potentialSnap.snapLine];
          isInSnapRange = true;
          // Ma NON applica lo snap durante il movimento - lascia libertà di movimento
        }

        // Aggiorna lo stato del drag
        setDragState(prev => prev ? {
          ...prev,
          currentStartTime: finalTime,
          currentTrack: newTrack,
          snapPoints: currentSnapPoints,
          potentialSnapTime: potentialSnap?.snapTime,
          isInSnapRange
        } : null);

        // Aggiorna le linee di snap
        setActiveSnapLines(snapLines);

        // SEMPRE aggiorna la posizione visiva durante il drag (anche se non valida)
        // Questo rimuove la "resistenza" permettendo movimento fluido su tutte le tracce
        // Il feedback visivo indica se la posizione è valida, la validazione finale avviene al rilascio
        const updatedItems = items.map(item => {
          if (dragState.draggedItems.some(draggedItem => draggedItem.id === item.id)) {
            // Trova i dati dell'elemento trascinato
            const draggedItemInfo = dragState.draggedItems.find(di => di.id === item.id);
            if (!draggedItemInfo) return item;

            if (item.id === draggedItem) {
              // Elemento principale - usa sempre la posizione calcolata per feedback visivo
              return {
                ...item,
                startTime: finalTime,
                track: newTrack
              };
            } else {
              // Elemento secondario - calcola posizione relativa
              const newItemTime = finalTime + draggedItemInfo.timeOffset;
              const newItemTrack = newTrack + draggedItemInfo.trackOffset;

              // Permetti sempre il movimento visivo, anche se non valido
              if (newItemTime >= 0 && newItemTrack >= 0 && newItemTrack < tracks.length) {
                return {
                  ...item,
                  startTime: newItemTime,
                  track: newItemTrack
                };
              } else {
                // Se fuori dai limiti della timeline, mantieni posizione originale
                return item;
              }
            }
          }
          return item;
        });
        onItemsChange(updatedItems);
      }
    };

    const handleMouseUp = () => {
      if (isSelecting) {
        // Fine selezione rettangolare
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionEnd(null);
      } else if (isDragging && draggedItem && dragState) {
        // Al rilascio: applica lo snap solo se siamo dentro la soglia
        const draggedItemData = items.find(i => i.id === draggedItem);
        if (draggedItemData) {
          let finalTime = dragState.currentStartTime;
          
          // Applica snap solo se è dentro la soglia E abbiamo un tempo di snap
          if (dragState.isInSnapRange && dragState.potentialSnapTime !== undefined) {
            finalTime = dragState.potentialSnapTime;
          }

          const finalItems = items.map(item => {
            if (dragState.draggedItems.some(draggedItem => draggedItem.id === item.id)) {
              // Trova i dati dell'elemento trascinato
              const draggedItemInfo = dragState.draggedItems.find(di => di.id === item.id);
              if (!draggedItemInfo) return item;

              if (item.id === draggedItem) {
                // Elemento principale - verifica compatibilità traccia
                if (isValidTrack(dragState.currentTrack, draggedItemData.mediaFile.type)) {
                  return {
                    ...item,
                    startTime: finalTime,
                    track: dragState.currentTrack
                  };
                } else {
                  // Track non valido per l'elemento principale, ripristina posizione originale
                  return {
                    ...item,
                    startTime: dragState.originalStartTime,
                    track: dragState.originalTrack
                  };
                }
              } else {
                // Elemento secondario - calcola posizione finale relativa
                const newItemTime = finalTime + draggedItemInfo.timeOffset;
                const newItemTrack = dragState.currentTrack + draggedItemInfo.trackOffset;

                // Verifica se la nuova posizione è valida per questo elemento specifico
                if (newItemTime >= 0 && newItemTrack >= 0 && newItemTrack < tracks.length && 
                    isValidTrack(newItemTrack, item.mediaFile.type)) {
                  return {
                    ...item,
                    startTime: newItemTime,
                    track: newItemTrack
                  };
                } else {
                  // Se la posizione non è valida per questo elemento, ripristina quella originale
                  return {
                    ...item,
                    startTime: draggedItemInfo.originalStartTime,
                    track: draggedItemInfo.originalTrack
                  };
                }
              }
            }
            return item;
          });

          // Salva nella history
          onItemsChangeWithHistory(finalItems);
        }
      }

      // Reset di tutti gli stati
      setIsDragging(false);
      setDraggedItem(null);
      setDragState(null);
      setResizing(null);
      setActiveSnapLines([]);
    };

    if (isDragging || resizing || isSelecting) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, draggedItem, dragState, resizing, isSelecting, selectionStart, items, scale, scrollLeft, scrollTop,
      calculateSnapPoints, findPotentialSnapPoint, isValidTrack, onItemsChange, onItemsChangeWithHistory, 
      selectedItems, getItemsInSelectionRect, tracks]);

  // Render timeline item
  const renderTimelineItem = (item: TimelineItem, track: number) => {
    const isDraggedItem = draggedItem === item.id;
    const isSelected = selectedItems.has(item.id);
    const isPartOfDrag = isDragging && dragState?.draggedItems.some(di => di.id === item.id);
    const isCutItem = cutItems.some(cutItem => cutItem.id === item.id); // Evidenzia elementi tagliati
    
    // Verifica se l'elemento è in una posizione non valida durante il drag
    const isInvalidPosition = isPartOfDrag && !isValidTrack(track, item.mediaFile.type);
    
    const left = item.startTime * scale;
    const width = item.duration * scale;
    const topPosition = track * 60 + 8;

    // AGGIORNATO: Aggiunto supporto per effetti
    const trackColors = {
      video: 'bg-blue-600',
      audio: 'bg-green-600',
      image: 'bg-purple-600',
      effect: 'bg-red-600' // Nuovo colore per gli effetti
    };

    return (
      <div
        key={item.id}
        className={`absolute h-12 rounded border-2 transition-none group
          ${trackColors[item.mediaFile.type]} ${
          isDraggedItem ? 'z-30 opacity-80 shadow-lg' : 
          isPartOfDrag ? 'z-25 opacity-75 shadow-md' : 'z-10'
        } ${
          isSelected ? 'border-yellow-400 ring-2 ring-yellow-400/50' : 
          isInvalidPosition ? 'border-red-500 ring-2 ring-red-500/50' : 
          isCutItem ? 'border-orange-400 ring-2 ring-orange-400/50' : 'border-white/20'
        } ${
          isPartOfDrag && !isDraggedItem ? 'ring-2 ring-blue-400/50' : ''
        } ${
          isInvalidPosition ? 'opacity-60' : isCutItem ? 'opacity-70' : ''
        } ${
          isInvalidPosition ? 'cursor-not-allowed' : 'cursor-move'
        }`}
        style={{
          left: `${left}px`,
          width: `${width}px`,
          top: `${topPosition}px`,
          transform: isPartOfDrag ? 'scale(1.02)' : 'none'
        }}
        onMouseDown={(e) => {
          // Se clicca con Ctrl, gestisci la selezione
          if (e.ctrlKey || e.metaKey) {
            handleItemClick(e, item);
          } else {
            handleMouseDown(e, item);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (selectedItems.size > 1 && selectedItems.has(item.id)) {
            // Context menu per selezione multipla
            setContextMenu({ 
              x: e.clientX, 
              y: e.clientY, 
              selectedItems: Array.from(selectedItems) 
            });
          } else {
            // Context menu per elemento singolo
            setContextMenu({ x: e.clientX, y: e.clientY, itemId: item.id });
          }
        }}
      >
        {/* Resize handles - SOLO per immagini ed effetti (NON per video/audio) e non durante drag multiplo */}
        {(item.mediaFile.type === 'image' || item.mediaFile.type === 'effect') && !isPartOfDrag && (
          <>
            <div
              className="absolute left-0 top-0 w-1 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/50"
              onMouseDown={(e) => handleMouseDown(e, item, 'left')}
            />
            <div
              className="absolute right-0 top-0 w-1 h-full cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/50"
              onMouseDown={(e) => handleMouseDown(e, item, 'right')}
            />
          </>
        )}

        <div className="p-2 h-full flex items-center justify-between text-white text-xs overflow-hidden select-none">
          <span className="truncate flex-1 select-none">{item.mediaFile.name}</span>
          <span className="ml-2 font-mono select-none">{formatTime(item.duration)}</span>
          {/* Indicatore di drag multiplo */}
          {isPartOfDrag && selectedItems.size > 1 && (
            <div className="absolute -top-1 -right-1 bg-blue-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
              {selectedItems.size}
            </div>
          )}
          {/* Indicatore di posizione non valida */}
          {isInvalidPosition && (
            <div className="absolute -top-1 -left-1 bg-red-500 text-white text-[8px] rounded-full w-3 h-3 flex items-center justify-center">
              !
            </div>
          )}
          {/* Indicatore di elemento tagliato */}
          {isCutItem && !isPartOfDrag && (
            <div className="absolute -top-1 -right-1 bg-orange-500 text-white text-[8px] rounded-full w-3 h-3 flex items-center justify-center">
              ✂
            </div>
          )}
          {/* Indicatore specifico per effetti */}
          {item.mediaFile.type === 'effect' && (
            <div className="absolute top-1 right-1 text-[10px] text-white/80">
              ✨
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render selection rectangle
  const renderSelectionRect = () => {
    if (!isSelecting || !selectionStart || !selectionEnd) return null;

    const left = Math.min(selectionStart.x, selectionEnd.x);
    const top = Math.min(selectionStart.y, selectionEnd.y);
    const width = Math.abs(selectionEnd.x - selectionStart.x);
    const height = Math.abs(selectionEnd.y - selectionStart.y);

    return (
      <div
        className="absolute pointer-events-none z-50 border border-yellow-400 bg-yellow-400/20"
        style={{
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`
        }}
      />
    );
  };

  // Group items by track usando il sistema dinamico
  const trackItems = tracks.map(track =>
    items.filter(item => item.track === track.index)
  );

  // Verifica se c'è contenuto da incollare
  const hasContentToPaste = copiedItem !== null || copiedItems.length > 0 || cutItems.length > 0;

  return (
    <div className="h-full flex flex-col bg-timeline-bg">
      {/* Zoom Indicator */}
      <div className="absolute top-2 right-4 z-40 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-sm">
        Zoom: {Math.round((scale / 50) * 100)}%
        <div className="text-[10px] text-gray-400 mt-1">Ctrl+Scroll per zoom</div>
        {selectedItems.size > 0 && (
          <div className="text-[10px] text-yellow-400 mt-1">
            {selectedItems.size} elementi selezionati
          </div>
        )}
        {cutItems.length > 0 && (
          <div className="text-[10px] text-orange-400 mt-1">
            {cutItems.length} elementi tagliati
          </div>
        )}
        {isDragging && draggedItem && dragState && (
          <div className="text-[10px] text-blue-400 mt-1">
            {(() => {
              const draggedItemData = items.find(i => i.id === draggedItem);
              const isValidPosition = draggedItemData && isValidTrack(dragState.currentTrack, draggedItemData.mediaFile.type);
              return isValidPosition ? '✓ Posizione valida' : '⚠️ Posizione non valida';
            })()}
          </div>
        )}
        {/* Indicatori scorciatoie */}
        <div className="text-[9px] text-gray-500 mt-1 border-t border-gray-600 pt-1">
          Ctrl+C/X/V | Canc
        </div>
      </div>

      {/* Timeline Header with Time Markers */}
      <div className="relative h-16 bg-gradient-timeline border-b border-border">
        <div className="absolute left-0 top-0 w-20 h-full bg-secondary/50 border-r border-border z-30 flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onTimeChange(0)}
            className="w-10 h-10 p-0 hover:bg-accent/50 rounded-md transition-colors"
            title="Go to start (0:00)"
          >
            <div className="w-0 h-0 border-t-[6px] border-b-[6px] border-r-[10px] border-t-transparent border-b-transparent border-r-muted-foreground"></div>
          </Button>
        </div>
        <div className="relative h-full cursor-pointer overflow-hidden ml-20">
          <div
            ref={timelineHeaderContentRef}
            className="relative h-full"
            style={{ width: `${timelineWidth}px` }}
            onClick={handleTimelineClick}
          >
            {generateTimeMarkers()}

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 bg-playhead z-30 pointer-events-none"
              style={{ 
                left: `${playheadPosition}px`,
                width: '2px'
              }}
            >
              <div 
                className="absolute bg-playhead rotate-45" 
                style={{ 
                  top: '-4px',
                  left: '-7px',
                  width: '16px',
                  height: '16px'
                }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Tracks */}
      <div className="flex-1 relative overflow-hidden">
        {/* Track Labels */}
        <div className="absolute left-0 top-0 w-20 h-full bg-secondary/50 border-r border-border z-20 overflow-hidden">
          <div className="track-labels-container">
            {tracks.map((track, index) => (
              <div key={track.id} className="relative">
                <div
                  className="absolute w-full h-14 flex flex-col items-center justify-center text-xs font-medium text-muted-foreground border-b border-border/30"
                  style={{ top: `${track.index * 60 + 8}px` }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (hasContentToPaste) {
                      handlePaste(track.index);
                    }
                  }}
                >
                  <span className="text-[10px] leading-tight mb-1">{track.label}</span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-4 h-4 p-0 text-[10px] hover:bg-green-500/50 text-green-400 hover:text-white rounded-sm"
                      onClick={() => addTrack(track.type, track.index)}
                      title={`Add new ${track.type} track`}
                    >
                      <Plus className="w-2 h-2" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`w-4 h-4 p-0 text-[10px] rounded-sm ${
                        canRemoveTrack(track) 
                          ? 'hover:bg-red-500/50 text-red-400 hover:text-white' 
                          : 'opacity-30 cursor-not-allowed text-gray-500'
                      }`}
                      onClick={() => canRemoveTrack(track) && removeTrack(track)}
                      disabled={!canRemoveTrack(track)}
                      title={
                        canRemoveTrack(track) 
                          ? `Remove ${track.type} track` 
                          : `Cannot remove: ${items.some(item => item.track === track.index) ? 'track has items' : 'minimum one track required'}`
                      }
                    >
                      <Minus className="w-2 h-2" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Timeline Content */}
        <div
          className="ml-20 relative h-full overflow-x-auto overflow-y-auto"
          onScroll={handleTimelineContentScroll}
          ref={timelineContentRef}
          onMouseDown={handleTimelineMouseDown}
          onContextMenu={handleTimelineContextMenu}
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#374151 #1f2937'
          }}
        >
          <div
            className="relative"
            style={{ width: `${timelineWidth}px`, height: `${timelineHeight}px` }}
          >
            {/* Track Backgrounds */}
            {tracks.map(track => (
              <div
                key={track.id}
                className="absolute w-full h-14 border-b border-border/30"
                style={{ top: `${track.index * 60 + 8}px` }}
              />
            ))}

            {/* Timeline Items */}
            {trackItems.map((trackItems, trackIndex) =>
              trackItems.map(item => renderTimelineItem(item, tracks[trackIndex].index))
            )}

            {/* Grid Lines */}
            <div className="absolute inset-0 pointer-events-none">
              {Array.from({ length: Math.ceil(totalDuration / (scale > 80 ? 1 : scale > 40 ? 5 : 10)) }).map((_, i) => {
                const interval = scale > 80 ? 1 : scale > 40 ? 5 : 10;
                return (
                  <div
                    key={i}
                    className="absolute w-px bg-border/30"
                    style={{ 
                      left: `${i * interval * scale}px`,
                      top: '0px',
                      height: `${timelineHeight}px`
                    }}
                  />
                );
              })}
            </div>

            {/* Snap Lines (barrette gialle) */}
            {activeSnapLines.map((snapTime, index) => (
              <div
                key={`snap-${index}`}
                className="absolute w-0.5 bg-yellow-400 pointer-events-none z-40 shadow-lg"
                style={{ 
                  left: `${snapTime * scale}px`,
                  top: '0px',
                  height: `${timelineHeight}px`
                }}
              />
            ))}

            {/* Selection Rectangle */}
            {renderSelectionRect()}
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
          {/* Mostra Copy e Cut solo se ci sono elementi selezionati o un itemId specifico */}
          {(contextMenu.itemId || (contextMenu.selectedItems && contextMenu.selectedItems.length > 0)) && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start px-3 py-1.5 h-auto text-xs"
                onClick={() => {
                  if (contextMenu.selectedItems && contextMenu.selectedItems.length > 1) {
                    // Copia multipla
                    handleCopy();
                  } else if (contextMenu.itemId) {
                    // Copia singola
                    const item = items.find(i => i.id === contextMenu.itemId);
                    if (item) handleCopy(item);
                  }
                }}
              >
                <Copy className="w-3 h-3 mr-2" />
                {contextMenu.selectedItems ? `Copy ${contextMenu.selectedItems.length} items` : 'Copy'}
                <span className="ml-auto text-xs text-muted-foreground">Ctrl+C</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start px-3 py-1.5 h-auto text-xs"
                onClick={() => {
                  if (contextMenu.selectedItems && contextMenu.selectedItems.length > 1) {
                    // Taglia multiplo
                    handleCut();
                  } else if (contextMenu.itemId) {
                    // Taglia singolo
                    const item = items.find(i => i.id === contextMenu.itemId);
                    if (item) handleCut(item);
                  }
                }}
              >
                <Scissors className="w-3 h-3 mr-2" />
                {contextMenu.selectedItems ? `Cut ${contextMenu.selectedItems.length} items` : 'Cut'}
                <span className="ml-auto text-xs text-muted-foreground">Ctrl+X</span>
              </Button>
            </>
          )}

          {/* Mostra Paste sempre quando c'è contenuto da incollare */}
          {hasContentToPaste && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start px-3 py-1.5 h-auto text-xs"
              onClick={() => {
                // Trova la traccia più adatta per il paste
                const getDefaultTrack = () => {
                  if (cutItems.length > 0) {
                    return cutItems[0].track;
                  } else if (copiedItems.length > 0) {
                    return copiedItems[0].track;
                  } else if (copiedItem) {
                    return copiedItem.track;
                  }
                  return 0;
                };
                
                handlePaste(getDefaultTrack());
                setContextMenu(null);
              }}
            >
              <Clipboard className="w-3 h-3 mr-2" />
              Paste
              <span className="ml-auto text-xs text-muted-foreground">Ctrl+V</span>
            </Button>
          )}
          
          {/* Split e Delete solo per elementi specifici */}
          {contextMenu.itemId && !contextMenu.selectedItems && (
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
          )}
          
          {(contextMenu.itemId || (contextMenu.selectedItems && contextMenu.selectedItems.length > 0)) && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start px-3 py-1.5 h-auto text-xs text-destructive hover:text-destructive"
              onClick={() => {
                if (contextMenu.selectedItems) {
                  handleDelete();
                } else {
                  handleDelete(contextMenu.itemId);
                }
              }}
            >
              <Trash2 className="w-3 h-3 mr-2" />
              {contextMenu.selectedItems ? `Delete ${contextMenu.selectedItems.length} items` : 'Delete'}
              <span className="ml-auto text-xs text-muted-foreground">Del</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
};