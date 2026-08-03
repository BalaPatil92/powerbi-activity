/* ============================================================
   AboutUsComponent — About Us page component.
   ============================================================ */

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-about-us',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './about-us.component.html',
  styleUrl: './about-us.component.scss',
})
export class AboutUsComponent {
  readonly teamMembers = [
    {
      name: 'Alex Rivera',
      role: 'Lead BI Architect',
      bio: 'Specializes in Power BI enterprise integrations, DAX modeling, and real-time dashboarding.',
      avatar: '📊',
    },
    {
      name: 'Dr. Sarah Chen',
      role: 'AI & LLM Engineer',
      bio: 'Focuses on contextual prompt engineering, automated report summarization, and NLP data insights.',
      avatar: '🤖',
    },
    {
      name: 'Marcus Vance',
      role: 'Full-Stack Developer',
      bio: 'Passionate about modern web application architecture, RxJS state management, and seamless UX.',
      avatar: '💻',
    },
  ];

  readonly keyFeatures = [
    {
      title: 'Power BI Embedding',
      description: 'Seamlessly embeds interactive Power BI reports with service principal authentication and fine-grained filter controls.',
      icon: '📈',
    },
    {
      title: 'Page-wise Context Capture',
      description: 'Automatically captures user activity, filter states, and slicers per dashboard page into localized or cloud storage.',
      icon: '💾',
    },
    {
      title: 'AI Slide Deck Outline',
      description: 'Leverages Anthropic LLM model to turn gathered data and page contexts into executive presentation slide outlines.',
      icon: '✨',
    },
  ];
}
