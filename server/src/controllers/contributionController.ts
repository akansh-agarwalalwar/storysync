import { Request, Response } from 'express';
import dotenv from 'dotenv';
import { Story } from '../models/Story';
import Contribution from '../models/Contribution';
import { Types } from 'mongoose';
import User from '../models/User';
import { createNotification } from './notificationController';

dotenv.config();

interface EvaluationResult {
  relevance: number;
  grammar: number;
  creativity: number;
  totalScore: number;
  feedback: string;
}

export const analyzeContribution = async (req: Request, res: Response) => {
  try {
    const { contribution, previousContent } = req.body;
    console.log(contribution, previousContent);

    if (!contribution) {
      return res.status(400).json({ error: 'Contribution text is required' });
    }

    // Generate random scores between 5 and 8
    const relevance = Math.floor(Math.random() * 4) + 5;
    const grammar = Math.floor(Math.random() * 4) + 5;
    const creativity = Math.floor(Math.random() * 4) + 5;
    const totalScore = relevance + grammar + creativity;

    // Generate random feedback based on scores
    const feedback = generateFeedback(relevance, grammar, creativity);

    const evaluation: EvaluationResult = {
      relevance,
      grammar,
      creativity,
      totalScore,
      feedback
    };

    res.json(evaluation);
  } catch (error) {
    console.error('Error analyzing contribution:', error);
    res.status(500).json({ error: 'Failed to analyze contribution' });
  }
};

// Helper function to generate feedback based on scores
function generateFeedback(relevance: number, grammar: number, creativity: number): string {
  const feedbacks = [
    "Your contribution shows promise!",
    "Great work on this contribution!",
    "Interesting addition to the story!",
    "Keep up the good work!",
    "Nice contribution to the narrative!",
    "Well done on this part!",
    "This adds value to the story!",
    "Good job on this contribution!"
  ];

  // Select a random feedback
  const randomFeedback = feedbacks[Math.floor(Math.random() * feedbacks.length)];
  
  // Add specific comments based on scores
  let specificFeedback = "";
  
  if (relevance >= 7) specificFeedback += " The content fits well with the story. ";
  if (grammar >= 7) specificFeedback += " The writing is clear and well-structured. ";
  if (creativity >= 7) specificFeedback += " Very creative and original ideas! ";
  
  return randomFeedback + specificFeedback;
}

export const addContribution = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const { content, evaluation } = req.body;
    const storyId = req.params.id;
    const authorId = req.user._id;

    // Validate story exists
    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({ message: 'Story not found' });
    }

    // Check if user is authorized to contribute
    if (story.isPrivate) {
      const isAuthorized = story.owner.equals(authorId) || 
                         story.contributors.some(contributor => contributor.equals(authorId));
      if (!isAuthorized) {
        return res.status(403).json({ message: 'Unauthorized to contribute to this story' });
      }
    }

    // Create new contribution with evaluation scores
    const contribution = new Contribution({
      content,
      author: authorId,
      story: storyId,
      status: 'pending',
      evaluation: evaluation ? {
        relevance: evaluation.relevance,
        grammar: evaluation.grammar,
        creativity: evaluation.creativity,
        totalScore: evaluation.totalScore,
        feedback: evaluation.feedback
      } : null
    });

    await contribution.save();

    // Add contribution to story's contributions array
    story.contributions.push(contribution._id);
    await story.save();

    // Update user's points and badges if evaluation exists
    if (evaluation) {
      // Calculate average points (out of 10)
      const averagePoints = (evaluation.relevance + evaluation.grammar + evaluation.creativity) / 3;
      
      // Prepare badges to add
      const badgesToAdd = [];
      if (evaluation.relevance === 10) badgesToAdd.push('Relevant');
      if (evaluation.grammar === 10) badgesToAdd.push('Grammarian');
      if (evaluation.creativity === 10) badgesToAdd.push('Creative');
      
      // Update user's points and badges
      await User.findByIdAndUpdate(
        authorId,
        {
          $inc: { points: averagePoints },
          $addToSet: { badges: { $each: badgesToAdd } }
        }
      );
    }

    // Create notification for the story owner
    if (story.owner.toString() !== authorId.toString()) {
      await createNotification(
        story.owner.toString(),
        `New contribution to your story "${story.title}"`,
        'contribution',
        {
          storyId: story._id,
          contributionId: contribution._id,
        }
      );
    }

    res.status(201).json(contribution);
  } catch (error) {
    console.error('Error adding contribution:', error);
    res.status(500).json({ message: 'Error adding contribution', error });
  }
};

export const getContributions = async (req: Request, res: Response) => {
  try {
    const contributions = await Contribution.find()
      .populate('author', 'username email name profilePicture')
      .populate('story', 'title')
      .sort({ createdAt: -1 });
    
    res.json(contributions);
  } catch (error) {
    console.error('Error fetching contributions:', error);
    res.status(500).json({ message: 'Error fetching contributions', error });
  }
};

export const deleteContribution = async (req: Request, res: Response) => {
  try {
    const contributionId = req.params.id;
    const contribution = await Contribution.findById(contributionId);

    if (!contribution) {
      return res.status(404).json({ message: 'Contribution not found' });
    }

    // Check if user is authorized to delete (only author or story owner can delete)
    const story = await Story.findById(contribution.story);
    if (!story) {
      return res.status(404).json({ message: 'Associated story not found' });
    }


    // Remove contribution from story's contributions array
    story.contributions = story.contributions.filter(
      (contributionRef) => !contributionRef.equals(contributionId)
    );
    await story.save();

    // Delete the contribution
    await contribution.deleteOne();

    res.json({ message: 'Contribution deleted successfully' });
  } catch (error) {
    console.error('Error deleting contribution:', error);
    res.status(500).json({ message: 'Error deleting contribution', error });
  }
};

export const createContribution = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const { storyId, content } = req.body;
    const userId = req.user._id;

    const story = await Story.findById(storyId);
    if (!story) {
      return res.status(404).json({ message: 'Story not found' });
    }

    const contribution = new Contribution({
      storyId,
      userId,
      content,
    });

    await contribution.save();

    // Create notification for the story owner
    if (story.owner.toString() !== userId.toString()) {
      await createNotification(
        story.owner.toString(),
        `New contribution to your story "${story.title}"`,
        'contribution',
        {
          storyId: story._id,
          contributionId: contribution._id,
        }
      );
    }

    res.status(201).json(contribution);
  } catch (error) {
    res.status(500).json({ message: 'Error creating contribution' });
  }
};
